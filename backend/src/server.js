import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { v4 as uuid } from 'uuid';
import { checkDatabase } from './db.js';
import {
	cancelReservation,
	createReservation,
	findUserByEmail,
	findUserById,
	getAnalyticsSummary,
	getLocation,
	insertUser,
	listLocations,
	listReservations,
	seedDemoData,
	updateParkingSlot,
} from './persistence.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 4000);
const SECRET = process.env.JWT_SECRET || 'local-development-secret';
const now = () => new Date().toISOString();
const users = [
	{ id: 'u-admin', name: 'System Admin', email: 'admin@parking.local', role: 'ADMIN', password: bcrypt.hashSync('Admin@123', 10) },
	{ id: 'u-operator', name: 'City Parking Team', email: 'operator@parking.local', role: 'PARKING_OPERATOR', password: bcrypt.hashSync('Operator@123', 10) },
	{ id: 'u-driver', name: 'Demo Driver', email: 'driver@parking.local', role: 'DRIVER', password: bcrypt.hashSync('Driver@123', 10) },
];
const locations = [
	{ id: 'loc-hampankatta', name: 'Hampankatta City Parking', address: 'K S Rao Road, Hampankatta', area: 'Hampankatta', latitude: 12.8703, longitude: 74.8431, pricePerHour: 30, description: 'Central covered parking near shops, offices, and the city bus stand.' },
	{ id: 'loc-kankanady', name: 'Kankanady Junction Parking', address: 'Mangaluru Bengaluru Highway, Kankanady', area: 'Kankanady', latitude: 12.8584, longitude: 74.8551, pricePerHour: 25, description: 'Convenient parking near the railway station and hospital district.' },
	{ id: 'loc-bejai', name: 'Bejai Commercial Complex', address: 'Bejai Main Road', area: 'Bejai', latitude: 12.8913, longitude: 74.8494, pricePerHour: 25, description: 'Secure multi-level parking for the Bejai retail and residential area.' },
	{ id: 'loc-kadri', name: 'Kadri Park Visitor Parking', address: 'Kadri Park Road', area: 'Kadri', latitude: 12.8847, longitude: 74.8559, pricePerHour: 20, description: 'Short-stay parking beside Kadri Park and surrounding neighbourhoods.' },
	{ id: 'loc-lalbagh', name: 'Lalbagh Transit Hub', address: 'Lalbagh, Mangaluru', area: 'Lalbagh', latitude: 12.8781, longitude: 74.8422, pricePerHour: 25, description: 'Central parking close to transit connections and commercial streets.' },
	{ id: 'loc-jyothi', name: 'Jyothi Circle Parking', address: 'Balmatta Road, Jyothi', area: 'Jyothi', latitude: 12.8742, longitude: 74.8466, pricePerHour: 30, description: 'Day parking near offices, restaurants, and educational institutions.' },
	{ id: 'loc-panambur', name: 'Panambur Beach Parking', address: 'Panambur Beach Road', area: 'Panambur', latitude: 12.9495, longitude: 74.8022, pricePerHour: 20, description: 'Open parking for beach visitors with evening and weekend availability.' },
	{ id: 'loc-surathkal', name: 'Surathkal Market Parking', address: 'Main Road, Surathkal', area: 'Surathkal', latitude: 13.0068, longitude: 74.7935, pricePerHour: 20, description: 'Public parking near the market, university route, and NH 66.' },
];
const slots = locations.flatMap((location, index) => Array.from({ length: 12 }, (_, i) => ({
	id: `${location.id}-S${i + 1}`,
	locationId: location.id,
	label: `${String.fromCharCode(65 + index)}-${String(i + 1).padStart(2, '0')}`,
	status: i < index + 2 ? 'OCCUPIED' : 'AVAILABLE',
	vehicleType: 'CAR',
})));
const reservations = [];
const traffic = [
	{ area: 'Hampankatta', level: 'HIGH', speed: 16, incidents: 3 },
	{ area: 'Kankanady', level: 'HIGH', speed: 21, incidents: 2 },
	{ area: 'Bejai', level: 'MEDIUM', speed: 29, incidents: 1 },
	{ area: 'Kadri', level: 'MEDIUM', speed: 27, incidents: 1 },
	{ area: 'Lalbagh', level: 'HIGH', speed: 19, incidents: 2 },
	{ area: 'Jyothi Circle', level: 'MEDIUM', speed: 24, incidents: 1 },
	{ area: 'Panambur', level: 'LOW', speed: 42, incidents: 0 },
	{ area: 'Surathkal', level: 'MEDIUM', speed: 32, incidents: 1 },
	{ area: 'Bendoorwell', level: 'LOW', speed: 38, incidents: 0 },
	{ area: 'Nanthoor Junction', level: 'HIGH', speed: 14, incidents: 3 },
];

let dbReady = false;

function auth(req, res, next) {
	const token = req.headers.authorization?.replace('Bearer ', '');
	if (!token) return res.status(401).json({ message: 'Authentication required' });
	try {
		req.user = jwt.verify(token, SECRET);
		next();
	} catch {
		return res.status(401).json({ message: 'Invalid token' });
	}
}

function roles(...allowed) {
	return (req, res, next) => allowed.includes(req.user.role)
		? next()
		: res.status(403).json({ message: 'Insufficient permissions' });
}

function publicUser(user) {
	if (!user) return null;
	const { password, ...safe } = user;
	return safe;
}

function issueToken(user) {
	return jwt.sign({ id: user.id, email: user.email, role: user.role }, SECRET, { expiresIn: '8h' });
}

app.get('/api/health', (req, res) => res.json({
	status: 'ok',
	service: 'backend',
	time: now(),
	database: dbReady ? 'mysql' : 'memory-fallback',
	redis: 'graceful-fallback',
}));

app.post('/api/auth/register', async (req, res, next) => {
	try {
		const { name, email, password } = req.body || {};
		if (!name || !email || !password || password.length < 8) {
			return res.status(400).json({ message: 'Name, email and a password of 8+ characters are required' });
		}
		const normalizedEmail = email.toLowerCase();
		if (users.some((user) => user.email === normalizedEmail)) {
			return res.status(409).json({ message: 'Email already registered' });
		}
		const user = {
			id: uuid(), name, email: normalizedEmail, role: 'DRIVER',
			password: await bcrypt.hash(password, 10),
		};
		if (dbReady) await insertUser(user);
		users.push(user);
		res.status(201).json({ user: publicUser(user), token: issueToken(user) });
	} catch (error) {
		if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email already registered' });
		next(error);
	}
});

app.post('/api/auth/login', async (req, res, next) => {
	try {
		const email = String(req.body?.email || '').toLowerCase();
		const user = users.find((item) => item.email === email) || (dbReady ? await findUserByEmail(email) : null);
		if (!user || !(await bcrypt.compare(req.body?.password || '', user.password))) {
			return res.status(401).json({ message: 'Invalid email or password' });
		}
		res.json({ user: publicUser(user), token: issueToken(user) });
	} catch (error) {
		next(error);
	}
});

app.get('/api/auth/me', auth, async (req, res, next) => {
	try {
		const user = users.find((item) => item.id === req.user.id) || (dbReady ? await findUserById(req.user.id) : null);
		res.json({ user: publicUser(user) });
	} catch (error) {
		next(error);
	}
});

app.get('/api/parking/locations', async (req, res, next) => {
	try {
		const q = String(req.query.q || '');
		const data = dbReady
			? await listLocations(q)
			: locations.filter((location) => !q || `${location.name} ${location.area} ${location.address}`.toLowerCase().includes(q.toLowerCase()))
				.map((location) => ({
					...location,
					available: slots.filter((slot) => slot.locationId === location.id && slot.status === 'AVAILABLE').length,
					total: slots.filter((slot) => slot.locationId === location.id).length,
				}));
		res.json({ data, pagination: { page: 1, pageSize: data.length, total: data.length } });
	} catch (error) {
		next(error);
	}
});

app.get('/api/parking/locations/:id', async (req, res, next) => {
	try {
		const location = dbReady
			? await getLocation(req.params.id)
			: locations.find((item) => item.id === req.params.id);
		if (!location) return res.status(404).json({ message: 'Location not found' });
		if (!dbReady) location.slots = slots.filter((slot) => slot.locationId === location.id);
		res.json(location);
	} catch (error) {
		next(error);
	}
});

app.post('/api/reservations', auth, roles('DRIVER'), async (req, res, next) => {
	try {
		const { slotId, startTime, endTime } = req.body || {};
		if (!slotId || !startTime || !endTime || new Date(endTime) <= new Date(startTime)) {
			return res.status(400).json({ message: 'A slot and a valid start and end time are required' });
		}
		if (dbReady) {
			const result = await createReservation({ id: uuid(), userId: req.user.id, slotId, startTime, endTime });
			if (result.error) return res.status(result.status).json({ message: result.error });
			io.emit('parking:slot-updated', { slotId, status: 'RESERVED' });
			return res.status(201).json(result.reservation);
		}
		const slot = slots.find((item) => item.id === slotId);
		if (!slot) return res.status(404).json({ message: 'Slot not found' });
		if (slot.status !== 'AVAILABLE') return res.status(409).json({ message: 'Slot is no longer available' });
		slot.status = 'RESERVED';
		const reservation = {
			id: uuid(), userId: req.user.id, slotId, locationId: slot.locationId,
			startTime, endTime, status: 'CONFIRMED', createdAt: now(),
		};
		reservations.push(reservation);
		io.emit('parking:slot-updated', { slotId, status: slot.status });
		res.status(201).json(reservation);
	} catch (error) {
		next(error);
	}
});

app.get('/api/reservations', auth, async (req, res, next) => {
	try {
		if (dbReady) return res.json(await listReservations(req.user));
		res.json(reservations
			.filter((reservation) => req.user.role !== 'DRIVER' || reservation.userId === req.user.id)
			.map((reservation) => ({
				...reservation,
				location: locations.find((location) => location.id === reservation.locationId),
				slot: slots.find((slot) => slot.id === reservation.slotId),
			})));
	} catch (error) {
		next(error);
	}
});

app.patch('/api/reservations/:id/cancel', auth, async (req, res, next) => {
	try {
		if (dbReady) {
			const result = await cancelReservation(req.params.id, req.user);
			if (result.error) return res.status(result.status).json({ message: result.error });
			io.emit('parking:slot-updated', { slotId: result.reservation.slotId, status: 'AVAILABLE' });
			return res.json(result.reservation);
		}
		const reservation = reservations.find((item) => item.id === req.params.id
			&& (req.user.role !== 'DRIVER' || item.userId === req.user.id));
		if (!reservation) return res.status(404).json({ message: 'Reservation not found' });
		if (reservation.status === 'CANCELLED') return res.status(400).json({ message: 'Reservation already cancelled' });
		reservation.status = 'CANCELLED';
		const slot = slots.find((item) => item.id === reservation.slotId);
		if (slot) slot.status = 'AVAILABLE';
		io.emit('parking:slot-updated', { slotId: reservation.slotId, status: 'AVAILABLE' });
		res.json(reservation);
	} catch (error) {
		next(error);
	}
});

app.get('/api/traffic', (req, res) => res.json({ simulated: true, city: 'Mangaluru', updatedAt: now(), data: traffic }));

app.get('/api/analytics/summary', auth, roles('ADMIN', 'PARKING_OPERATOR'), async (req, res, next) => {
	try {
		if (dbReady) return res.json(await getAnalyticsSummary());
		res.json({
			users: users.length,
			locations: locations.length,
			slots: slots.length,
			available: slots.filter((slot) => slot.status === 'AVAILABLE').length,
			reservations: reservations.length,
			occupancy: Math.round(slots.filter((slot) => slot.status !== 'AVAILABLE').length / slots.length * 100),
		});
	} catch (error) {
		next(error);
	}
});

app.patch('/api/parking/slots/:id', auth, roles('ADMIN', 'PARKING_OPERATOR'), async (req, res, next) => {
	try {
		if (dbReady) {
			const result = await updateParkingSlot(req.params.id, req.body.status === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE');
			if (result.error) return res.status(result.status).json({ message: result.error });
			io.emit('parking:slot-updated', { slotId: result.slot.id, status: result.slot.status });
			return res.json(result.slot);
		}
		const slot = slots.find((item) => item.id === req.params.id);
		if (!slot) return res.status(404).json({ message: 'Slot not found' });
		if (slot.status === 'RESERVED') return res.status(409).json({ message: 'Reserved slots cannot be manually changed' });
		slot.status = req.body.status === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE';
		io.emit('parking:slot-updated', { slotId: slot.id, status: slot.status });
		res.json(slot);
	} catch (error) {
		next(error);
	}
});

app.get('/api/ai/predictions', async (req, res) => {
	try {
		const response = await fetch(`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/predict/parking`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				location_id: req.query.locationId || 'loc-central',
				hour: Number(req.query.hour || 12),
				day_of_week: new Date().getDay(),
				capacity: 12,
			}),
		});
		res.json(await response.json());
	} catch {
		res.json({ source: 'fallback', prediction: 'AI service unavailable', estimated_occupancy: 65, estimated_available: 4 });
	}
});

app.use((error, req, res, next) => {
	console.error(error);
	res.status(500).json({ message: 'Unexpected server error' });
});

async function startServer() {
	for (let attempt = 1; attempt <= 30; attempt += 1) {
		if (await checkDatabase()) {
			try {
				await seedDemoData(users, locations, slots);
				dbReady = true;
				console.log('MySQL connected; demo data is ready');
			} catch (error) {
				console.warn(`MySQL seed failed; using in-memory demo data (${error.message})`);
			}
			break;
		}
		if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	if (!dbReady) console.warn('MySQL unavailable after 30 seconds; using in-memory demo data');
	server.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
}

if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) void startServer();

export { app, server, users, locations, slots, reservations };
