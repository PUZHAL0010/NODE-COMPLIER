const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// In-Memory Database State
let parkingLot = {
    capacity: 0,
    slots: [] // Array representing each slot. null = empty, object = parked car
};

/**
 * 1. Initialize/Create a Parking Lot
 * POST /api/parking-lot
 * Body: { "capacity": 10 }
 */
app.post('/api/parking-lot', (req, res) => {
    const { capacity } = req.body;

    if (!capacity || typeof capacity !== 'number' || capacity <= 0) {
        return res.status(400).json({ error: "Please provide a valid numeric capacity greater than 0." });
    }

    parkingLot.capacity = capacity;
    // Create an empty array array filled with null values representing vacant spots
    parkingLot.slots = new Array(capacity).fill(null);

    return res.status(201).json({
        message: `Parking lot successfully created with ${capacity} slots.`,
        capacity: parkingLot.capacity
    });
});

/**
 * 2. Park a Car (Allocates the nearest available slot)
 * POST /api/park
 * Body: { "registrationNumber": "ABC-123", "color": "Red" }
 */
app.post('/api/park', (req, res) => {
    const { registrationNumber, color } = req.body;

    if (parkingLot.capacity === 0) {
        return res.status(400).json({ error: "Parking lot has not been initialized yet." });
    }

    if (!registrationNumber || !color) {
        return res.status(400).json({ error: "Missing registrationNumber or color in request." });
    }

    // Find the first empty slot (index)
    const availableSlotIndex = parkingLot.slots.findIndex(slot => slot === null);

    if (availableSlotIndex === -1) {
        return res.status(400).json({ message: "Parking lot is full!" });
    }

    // Park the car
    const slotNumber = availableSlotIndex + 1; // 1-indexed for real-world usability
    parkingLot.slots[availableSlotIndex] = {
        registrationNumber,
        color,
        parkedAt: new Date()
    };

    return res.status(200).json({
        message: "Car parked successfully.",
        slotNumber: slotNumber,
        carDetails: parkingLot.slots[availableSlotIndex]
    });
});

/**
 * 3. Leave the Parking Slot (Vacate spot)
 * DELETE /api/leave/:slotNumber
 */
app.delete('/api/leave/:slotNumber', (req, res) => {
    const slotNumber = parseInt(req.params.slotNumber);
    const slotIndex = slotNumber - 1;

    if (isNaN(slotNumber) || slotNumber <= 0 || slotNumber > parkingLot.capacity) {
        return res.status(400).json({ error: "Invalid slot number provided." });
    }

    if (parkingLot.slots[slotIndex] === null) {
        return res.status(400).json({ message: `Slot ${slotNumber} is already empty.` });
    }

    const removedCar = parkingLot.slots[slotIndex];
    parkingLot.slots[slotIndex] = null; // Vacate slot

    return res.status(200).json({
        message: `Slot ${slotNumber} is now free.`,
        departedCar: removedCar
    });
});

/**
 * 4. Get Current Dashboard/Status
 * GET /api/status
 */
app.get('/api/status', (req, res) => {
    if (parkingLot.capacity === 0) {
        return res.status(400).json({ error: "Parking lot has not been initialized yet." });
    }

    const occupiedSlots = [];
    let availableCount = 0;

    parkingLot.slots.forEach((car, index) => {
        if (car) {
            occupiedSlots.push({
                slotNumber: index + 1,
                registrationNumber: car.registrationNumber,
                color: car.color
            });
        } else {
            availableCount++;
        }
    });

    return res.status(200).json({
        totalCapacity: parkingLot.capacity,
        availableSlotsCount: availableCount,
        occupiedSlotsCount: occupiedSlots.length,
        occupiedSlotsDetails: occupiedSlots
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Car Parking API Server running on port http://localhost:${PORT}`);
});
