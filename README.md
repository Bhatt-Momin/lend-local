# LendLocal

LendLocal is a web-based shared expense and lending management application designed for small groups such as friends, roommates, and classmates.

It allows users to create groups, add members, record shared expenses, split expenses, and automatically calculate balances and settlements.

## Features

- User registration and login
- JWT-based authentication
- Create groups
- Add members to groups by email
- Add shared expenses
- Equal expense splitting
- Custom expense splitting
- Automatic balance calculation
- "Who owes whom" settlement calculation
- Dashboard with per-group balance summaries
- View group members
- Delete expenses
- Logout

## Tech Stack

### Frontend
- HTML5
- CSS3
- Vanilla JavaScript

### Backend
- Node.js
- Express.js

### Database
- MongoDB
- MongoDB Atlas for production

### Authentication
- JSON Web Tokens (JWT)
- bcryptjs for password hashing

### Deployment
- Render

---

## Project Structure

```text
lend-local/
│
├── backend/
│   ├── config/
│   │   └── db.js
│   │
│   ├── middleware/
│   │   └── auth.js
│   │
│   ├── models/
│   │   ├── User.js
│   │   ├── Group.js
│   │   └── Expense.js
│   │
│   ├── routes/
│   │   ├── auth.js
│   │   ├── groups.js
│   │   ├── expenses.js
│   │   └── balances.js
│   │
│   ├── scripts/
│   │   └── seed.js
│   │
│   ├── utils/
│   │   └── helpers.js
│   │
│   ├── server.js
│   ├── package.json
│   └── package-lock.json
│
├── frontend/
│   ├── css/
│   │   └── styles.css
│   │
│   ├── js/
│   │   ├── api.js
│   │   ├── dashboard.js
│   │   └── group.js
│   │
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── dashboard.html
│   └── group.html
│
├── .gitignore
└── README.md