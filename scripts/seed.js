require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lendlocal';
  await mongoose.connect(uri);
  console.log('Connected. Clearing existing data…');

  await Promise.all([User.deleteMany({}), Group.deleteMany({}), Expense.deleteMany({})]);

  const momin = await User.create({
    name: 'Momin Nazir',
    email: 'momin@lendlocal.test',
    password: 'password123',
  });
  const tufail = await User.create({
    name: 'Tufail Mir',
    email: 'tufail@lendlocal.test',
    password: 'password123',
  });
  const kamil = await User.create({
    name: 'Kamil Raja',
    email: 'kamil@lendlocal.test',
    password: 'password123',
  });

  const hostel = await Group.create({
    name: 'Hostel Room 12',
    description: 'Rent, groceries, and monthly utilities',
    createdBy: momin._id,
    members: [momin._id, tufail._id, kamil._id],
  });

  const trip = await Group.create({
    name: 'Gulmarg Trip',
    description: 'Weekend snow trip expenses',
    createdBy: tufail._id,
    members: [momin._id, tufail._id],
  });

  await Expense.create([
    {
      group: hostel._id,
      description: 'Monthly rent share',
      amount: 15000,
      paidBy: momin._id,
      splitType: 'equal',
      category: 'Rent',
      splits: [
        { user: momin._id, share: 5000 },
        { user: tufail._id, share: 5000 },
        { user: kamil._id, share: 5000 },
      ],
    },
    {
      group: hostel._id,
      description: 'Groceries — week 1',
      amount: 2400,
      paidBy: tufail._id,
      splitType: 'equal',
      category: 'Food',
      splits: [
        { user: momin._id, share: 800 },
        { user: tufail._id, share: 800 },
        { user: kamil._id, share: 800 },
      ],
    },
    {
      group: hostel._id,
      description: 'Electricity bill',
      amount: 1800,
      paidBy: kamil._id,
      splitType: 'custom',
      category: 'Utilities',
      splits: [
        { user: momin._id, share: 600 },
        { user: tufail._id, share: 600 },
        { user: kamil._id, share: 600 },
      ],
    },
    {
      group: trip._id,
      description: 'Cab to Gulmarg',
      amount: 3200,
      paidBy: tufail._id,
      splitType: 'equal',
      category: 'Travel',
      splits: [
        { user: momin._id, share: 1600 },
        { user: tufail._id, share: 1600 },
      ],
    },
    {
      group: trip._id,
      description: 'Ski rental',
      amount: 2500,
      paidBy: momin._id,
      splitType: 'equal',
      category: 'Entertainment',
      splits: [
        { user: momin._id, share: 1250 },
        { user: tufail._id, share: 1250 },
      ],
    },
  ]);

  console.log('Seed complete.\n');
  console.log('Demo accounts (password: password123):');
  console.log('  momin@lendlocal.test');
  console.log('  tufail@lendlocal.test');
  console.log('  kamil@lendlocal.test');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
