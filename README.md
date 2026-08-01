# LendLocal

Web-based shared expense and lending management for small groups (friends, roommates, classmates).

Built per the project synopsis: **HTML5 / CSS3 / vanilla JS** frontend, **Node.js + Express** backend, **MongoDB** database, **JWT** auth.

## Features

- Register / login
- Create groups and invite members by email
- Add expenses with equal or custom splits
- Automatic balance calculation and “who owes whom” settlements
- Dashboard with per-group balance summary
- Delete expenses; add members to existing groups

## Requirements

- Node.js 18+
- MongoDB 6+ running locally (or set `MONGODB_URI` to Atlas)

## Setup

```bash
cd prototype
npm install

# Ensure MongoDB is running on localhost:27017, then:
npm run seed   # optional demo data
npm start
```

Open [http://localhost:3000](http://localhost:3000).

### Demo accounts (after seed)

| Email | Password |
|---|---|
| momin@lendlocal.test | password123 |
| tufail@lendlocal.test | password123 |
| kamil@lendlocal.test | password123 |

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Current user |
| GET | `/api/groups` | List my groups |
| POST | `/api/groups` | Create group |
| GET | `/api/groups/:id` | Group details |
| POST | `/api/groups/:id/members` | Add member |
| GET | `/api/expenses/:groupId` | List expenses |
| POST | `/api/expenses` | Add expense |
| DELETE | `/api/expenses/:id` | Delete expense |
| GET | `/api/balances/:groupId` | Balances & settlements |

Protected routes require header: `Authorization: Bearer <token>`.

## Project structure

```
prototype/
├── server.js
├── config/db.js
├── models/          # User, Group, Expense
├── routes/          # auth, groups, expenses, balances
├── middleware/auth.js
├── utils/helpers.js # JWT + balance math
├── scripts/seed.js
└── public/          # static frontend
```
