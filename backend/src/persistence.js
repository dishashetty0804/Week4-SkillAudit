import { pool } from './db.js';

function formatLocation(row) {
	return {
		id: row.id,
		name: row.name,
		address: row.address,
		area: row.area,
		latitude: Number(row.latitude),
		longitude: Number(row.longitude),
		pricePerHour: Number(row.pricePerHour ?? row.price_per_hour),
		description: row.description,
		...(row.available !== undefined && { available: Number(row.available) }),
		...(row.total !== undefined && { total: Number(row.total) }),
	};
}

function toSqlDate(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error('A valid startTime and endTime are required');
	return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function seedDemoData(users, locations, slots) {
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		for (const user of users) {
			await connection.execute(
				'INSERT IGNORE INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
				[user.id, user.name, user.email, user.password, user.role],
			);
		}
		for (const location of locations) {
			await connection.execute(
				`INSERT IGNORE INTO parking_locations
					(id, name, address, area, latitude, longitude, price_per_hour, description)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[location.id, location.name, location.address, location.area, location.latitude,
					location.longitude, location.pricePerHour, location.description],
			);
		}
		for (const slot of slots) {
			await connection.execute(
				'INSERT IGNORE INTO parking_slots (id, location_id, label, status, vehicle_type) VALUES (?, ?, ?, ?, ?)',
				[slot.id, slot.locationId, slot.label, slot.status, slot.vehicleType],
			);
		}
		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

export async function findUserByEmail(email) {
	const [rows] = await pool.execute(
		'SELECT id, name, email, role, password_hash AS password FROM users WHERE email = ?',
		[email],
	);
	return rows[0];
}

export async function findUserById(id) {
	const [rows] = await pool.execute(
		'SELECT id, name, email, role FROM users WHERE id = ?', [id],
	);
	return rows[0];
}

export async function insertUser(user) {
	await pool.execute(
		'INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
		[user.id, user.name, user.email, user.password, user.role],
	);
}

export async function listLocations(search = '') {
	const pattern = `%${search}%`;
	const [rows] = await pool.execute(
		`SELECT l.id, l.name, l.address, l.area, l.latitude, l.longitude,
			l.price_per_hour AS pricePerHour, l.description,
			COUNT(s.id) AS total, COALESCE(SUM(s.status = 'AVAILABLE'), 0) AS available
		 FROM parking_locations l
		 LEFT JOIN parking_slots s ON s.location_id = l.id
		 WHERE ? = '' OR CONCAT(l.name, ' ', l.area, ' ', l.address) LIKE ?
		 GROUP BY l.id ORDER BY l.name`,
		[search, pattern],
	);
	return rows.map(formatLocation);
}

export async function getLocation(id) {
	const [locations] = await pool.execute(
		`SELECT id, name, address, area, latitude, longitude,
			price_per_hour AS pricePerHour, description
		 FROM parking_locations WHERE id = ?`, [id],
	);
	if (!locations[0]) return null;
	const [slots] = await pool.execute(
		'SELECT id, location_id AS locationId, label, status, vehicle_type AS vehicleType FROM parking_slots WHERE location_id = ? ORDER BY label',
		[id],
	);
	return { ...formatLocation(locations[0]), slots };
}

export async function createReservation({ id, userId, slotId, startTime, endTime }) {
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		const [slots] = await connection.execute(
			'SELECT id, location_id AS locationId FROM parking_slots WHERE id = ? FOR UPDATE', [slotId],
		);
		if (!slots[0]) {
			await connection.rollback();
			return { error: 'Slot not found', status: 404 };
		}
		const [updated] = await connection.execute(
			"UPDATE parking_slots SET status = 'RESERVED' WHERE id = ? AND status = 'AVAILABLE'", [slotId],
		);
		if (!updated.affectedRows) {
			await connection.rollback();
			return { error: 'Slot is no longer available', status: 409 };
		}
		const sqlStart = toSqlDate(startTime);
		const sqlEnd = toSqlDate(endTime);
		await connection.execute(
			'INSERT INTO reservations (id, user_id, slot_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
			[id, userId, slotId, sqlStart, sqlEnd],
		);
		await connection.commit();
		return {
			reservation: {
				id, userId, slotId, locationId: slots[0].locationId,
				startTime: new Date(startTime).toISOString(), endTime: new Date(endTime).toISOString(),
				status: 'CONFIRMED', createdAt: new Date().toISOString(),
			},
		};
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

export async function listReservations(user) {
	const driverFilter = user.role === 'DRIVER' ? 'WHERE r.user_id = ?' : '';
	const params = user.role === 'DRIVER' ? [user.id] : [];
	const [rows] = await pool.execute(
		`SELECT r.id, r.user_id AS userId, r.slot_id AS slotId, s.location_id AS locationId,
			r.start_time AS startTime, r.end_time AS endTime, r.status, r.created_at AS createdAt,
			l.id AS location_id, l.name AS location_name, l.address AS location_address,
			l.area AS location_area, l.latitude AS location_latitude, l.longitude AS location_longitude,
			l.price_per_hour AS location_price, l.description AS location_description,
			s.label AS slot_label, s.status AS slot_status, s.vehicle_type AS slot_vehicle_type
		 FROM reservations r
		 JOIN parking_slots s ON s.id = r.slot_id
		 JOIN parking_locations l ON l.id = s.location_id
		 ${driverFilter} ORDER BY r.created_at DESC`,
		params,
	);
	return rows.map((row) => ({
		id: row.id,
		userId: row.userId,
		slotId: row.slotId,
		locationId: row.locationId,
		startTime: row.startTime,
		endTime: row.endTime,
		status: row.status,
		createdAt: row.createdAt,
		location: formatLocation({
			id: row.location_id, name: row.location_name, address: row.location_address,
			area: row.location_area, latitude: row.location_latitude, longitude: row.location_longitude,
			pricePerHour: row.location_price, description: row.location_description,
		}),
		slot: {
			id: row.slotId, locationId: row.locationId, label: row.slot_label,
			status: row.slot_status, vehicleType: row.slot_vehicle_type,
		},
	}));
}

export async function cancelReservation(id, user) {
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		const driverFilter = user.role === 'DRIVER' ? 'AND user_id = ?' : '';
		const params = user.role === 'DRIVER' ? [id, user.id] : [id];
		const [rows] = await connection.execute(
			`SELECT id, user_id AS userId, slot_id AS slotId, start_time AS startTime,
				end_time AS endTime, status FROM reservations WHERE id = ? ${driverFilter} FOR UPDATE`,
			params,
		);
		const reservation = rows[0];
		if (!reservation) {
			await connection.rollback();
			return { error: 'Reservation not found', status: 404 };
		}
		if (reservation.status === 'CANCELLED') {
			await connection.rollback();
			return { error: 'Reservation already cancelled', status: 400 };
		}
		await connection.execute("UPDATE reservations SET status = 'CANCELLED' WHERE id = ?", [id]);
		await connection.execute("UPDATE parking_slots SET status = 'AVAILABLE' WHERE id = ?", [reservation.slotId]);
		await connection.commit();
		return { reservation: { ...reservation, status: 'CANCELLED' } };
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

export async function updateParkingSlot(id, status) {
	const [result] = await pool.execute(
		"UPDATE parking_slots SET status = ? WHERE id = ? AND status <> 'RESERVED'",
		[status, id],
	);
	if (!result.affectedRows) {
		const [rows] = await pool.execute('SELECT id, status FROM parking_slots WHERE id = ?', [id]);
		if (!rows[0]) return { error: 'Slot not found', status: 404 };
		if (rows[0].status === 'RESERVED') return { error: 'Reserved slots cannot be manually changed', status: 409 };
	}
	const [rows] = await pool.execute(
		'SELECT id, location_id AS locationId, label, status, vehicle_type AS vehicleType FROM parking_slots WHERE id = ?',
		[id],
	);
	return { slot: rows[0] };
}

export async function getAnalyticsSummary() {
	const [[summary]] = await pool.query(
		`SELECT (SELECT COUNT(*) FROM users) AS users,
			(SELECT COUNT(*) FROM parking_locations) AS locations,
			(SELECT COUNT(*) FROM parking_slots) AS slots,
			(SELECT SUM(status = 'AVAILABLE') FROM parking_slots) AS available,
			(SELECT COUNT(*) FROM reservations) AS reservations,
			(SELECT ROUND(SUM(status <> 'AVAILABLE') / COUNT(*) * 100) FROM parking_slots) AS occupancy`,
	);
	return Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value)]));
}
