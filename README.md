# Present-Me Backend

REST API behind [presentme.in](https://presentme.in): the institute admin panel, the super-admin panel and the Present-Me mobile app.

It handles four kinds of users (**institute admins**, **teachers**, **students**, **super admins**) and covers:

- institute and teacher onboarding and approval
- classes and join requests
- manual and smart (session-based) attendance
- class and institution-wide notices
- a notes/PYQ marketplace, with a wallet and payout withdrawals for uploaders

## Tech stack

| Concern        | Library                                              |
|----------------|------------------------------------------------------|
| HTTP server    | Express 5                                            |
| Database       | AWS DynamoDB (`@aws-sdk/client-dynamodb`, `lib-dynamodb`) |
| File storage   | AWS S3 (`@aws-sdk/client-s3`), uploads via `multer`  |
| Auth           | JWT (`jsonwebtoken`), passwords hashed with `bcrypt`/`bcryptjs` |
| Validation     | Joi                                                  |
| Email          | Nodemailer (SMTP), Verifalia (address validation)    |

## Getting started

**Prerequisites:** Node.js 18+ (developed on Node 24), and AWS credentials with access to the DynamoDB tables and S3 bucket listed below.

```bash
npm install
# create .env in the project root (see below)
npm run dev      # nodemon, restarts on change
# or
npm start        # node src/app.js
```

The server listens on **port 2000**. `GET /` returns `Present-Me back running` when it is up.

### Environment variables

Create a `.env` file in the project root. It is git-ignored; never commit it.

| Variable                | Used for                                                     |
|-------------------------|--------------------------------------------------------------|
| `AWS_ACCESS_KEY_ID`     | AWS credentials for DynamoDB and S3                          |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for DynamoDB and S3                          |
| `AWS_REGION`            | AWS region (production uses `ap-south-1`)                    |
| `AWS_S3_BUCKET`         | Bucket for profile pictures, documents and notes             |
| `JWT_SECRET`            | Signing secret for all auth tokens                           |
| `NODE_ENV`              | Set to `production` in prod (enables `secure` auth cookies)  |
| `FRONTEND_URL`          | Base URL used in email verification links                    |
| `EMAIL_USER`            | SMTP username and "from" address for outgoing email          |
| `EMAIL_PASSWORD`        | SMTP password                                                |
| `VERIFALIA_USERNAME`    | Verifalia email-validation API credentials                   |
| `VERIFALIA_PASSWORD`    | Verifalia email-validation API credentials                   |

### Scripts

| Command                     | What it does                                                       |
|-----------------------------|--------------------------------------------------------------------|
| `npm start`                 | Start the server (`node src/app.js`)                               |
| `npm run dev`               | Start with nodemon for local development                           |
| `node scripts/testDynamo.js`| Check DynamoDB connectivity (reads 1 item from `Institutions`)     |
| `node scripts/testS3.js`    | Check S3 connectivity (lists buckets)                              |

> ⚠️ The scripts use the credentials in `.env`. If that points at production, they talk to production.

## Project structure

```
├── scripts/                     # Manual connectivity checks (not loaded by the app)
│   ├── testDynamo.js
│   └── testS3.js
└── src/
    ├── app.js                   # Entry point: Express setup, global middleware, server start
    ├── config/
    │   └── dynamodb.js          # Shared DynamoDB client + DocumentClient
    ├── controllers/             # Request handlers used by routes     (*.controller.js)
    ├── middlewares/             # Auth guards                          (*.middleware.js)
    ├── services/                # Data access and external services   (*.service.js)
    ├── validations/             # Joi schemas                          (*.validation.js)
    ├── utils/                   # Small pure helpers
    ├── public/                  # Static files (.well-known/assetlinks.json)
    └── routes/
        ├── index.js             # Mounts every router. ORDER MATTERS, see below
        ├── admin/               # Institute admin     (/admin/*)
        ├── superAdmin/          # Super admin         (/sadmin/*)
        ├── student/             # Student             (/students/*, /wallet/*, /withdrawal/*)
        ├── teacher/             # Teacher             (/teachers/*, plus some /students/* attendance & notices)
        ├── common/              # Shared              (/delete-request)
        ├── public/              # Unauthenticated     (/public/stats)
        └── dev/                 # Test endpoints      (/test-email, /test-verifalia)
```

### Naming conventions

| Layer       | Pattern                  | Example                        |
|-------------|--------------------------|--------------------------------|
| Folders     | camelCase                | `superAdmin/`                  |
| Routes      | `<feature>.routes.js`    | `teacher/attendance.routes.js` |
| Controllers | `<entity>.controller.js` | `student.controller.js`        |
| Services    | `<entity>.service.js`    | `teacher.service.js`           |
| Middlewares | `<name>.middleware.js`   | `teacherAuth.middleware.js`    |
| Validations | `<entity>.validation.js` | `teacher.validation.js`        |

### Adding a new route

1. Add it to the matching `src/routes/<role>/*.routes.js` file, or create a new `<feature>.routes.js` file there.
2. Protect it with the right auth middleware (see [Authentication](#authentication)). Only leave it public on purpose.
3. If you created a new file, mount it in `src/routes/index.js` **at the end of the list**.

Express matches routes in registration order. Every router is mounted at `/`, so reordering `routes/index.js` can change which handler answers a request.

## Authentication

Login endpoints return a JWT and also set it as an `httpOnly` cookie named `token`. Protected endpoints accept either form:

- **Cookie:** `token=<jwt>` (web panels, sent with `withCredentials: true`)
- **Header:** `Authorization: Bearer <jwt>` (mobile app)

| Middleware      | File                                   | Allows            | Sets on `req`            |
|-----------------|----------------------------------------|-------------------|--------------------------|
| `studAuth`      | `studentAuth.middleware.js`            | Students          | `req.student`            |
| `tAuth`         | `teacherAuth.middleware.js`            | Teachers          | `req.teacherId` (full teacher record) |
| `anyAuth`       | `anyAuth.middleware.js`                | Students or teachers | `req.student` or `req.teacherId` |
| `instituteAuth` | `instituteAuth.middleware.js`          | Institute admins  | `req.institute`          |
| `SAuth`         | `superAdminAuth.middleware.js`         | Super admins      | `req.admin`              |

A request without a token gets `401 { "message": "No auth token, access denied" }`.

## API reference

Every endpoint is mounted at the root; there is no `/api` prefix. **Auth** gives who can call the endpoint; `—` means it is public.

### Public and shared

| Method | Endpoint                        | Auth               | Description                                             | File                    |
|--------|---------------------------------|--------------------|---------------------------------------------------------|-------------------------|
| GET    | `/`                             | —                  | Health check                                            | `app.js`                |
| GET    | `/.well-known/assetlinks.json`  | —                  | Android App Links verification file                     | `app.js`                |
| GET    | `/public/stats`                 | —                  | Platform totals for the landing page (cached 10 min)    | `public/stats`          |
| GET    | `/getColleges`                  | —                  | Verified institution names for signup dropdowns         | `teacher/auth`          |
| POST   | `/delete-request`               | —                  | Submit an account deletion request (`email`, `reason`)  | `common/deleteAccount`  |
| POST   | `/change-password`              | Student or teacher | Change the logged-in user's password                    | `student/auth`          |

### Institute admin (`/admin`)

| Method | Endpoint                                          | Auth      | Description                                                        | File                  |
|--------|---------------------------------------------------|-----------|--------------------------------------------------------------------|-----------------------|
| POST   | `/admin/signup`                                   | —         | Register an institution (multipart: `aadhar`, `designationID` files) | `admin/auth`        |
| POST   | `/admin/login`                                    | —         | Log in; returns token + sets cookie                                | `admin/auth`          |
| POST   | `/admin/logout`                                   | —         | Clear the auth cookie                                              | `admin/auth`          |
| POST   | `/admin/change-password`                          | Institute | Change password                                                    | `admin/auth`          |
| GET    | `/admin/profile`                                  | Institute | Get institution profile                                            | `admin/dashboard`     |
| PATCH  | `/admin/profile`                                  | Institute | Update profile (multipart, optional `profilePicUrl` image)         | `admin/dashboard`     |
| GET    | `/admin/approvedTeachers`                         | Institute | Verified teachers of the institution                               | `admin/dashboard`     |
| GET    | `/admin/pendingTeachers`                          | Institute | Teachers awaiting approval                                         | `admin/dashboard`     |
| PATCH  | `/admin/institutes/teachers/:teacherId/status`    | Institute | Approve/reject a teacher (`{ status }`)                            | `admin/teacherStatus` |
| GET    | `/admin/teachers/:teacherId/classes`              | Institute | Classes taught by a teacher                                        | `admin/teacher`       |
| GET    | `/admin/students`                                 | Institute | Students of the institution                                        | `admin/dashboard`     |
| GET    | `/admin/students/:studentId/classes`              | Institute | Classes a student is enrolled in                                   | `admin/student`       |
| GET    | `/admin/classes`                                  | Institute | All classes in the institution                                     | `admin/attendance`    |
| GET    | `/admin/class/:classCode/students`                | Institute | Students in a class                                                | `admin/teacher`       |
| GET    | `/admin/download/class-attendance/:classCode`     | Institute | Attendance report data for a class (JSON)                          | `admin/attendance`    |

### Super admin (`/sadmin`)

| Method | Endpoint                                  | Auth        | Description                                                            | File                  |
|--------|-------------------------------------------|-------------|------------------------------------------------------------------------|-----------------------|
| POST   | `/sadmin/login`                           | —           | Log in; returns token + sets cookie                                    | `superAdmin/auth`     |
| POST   | `/sadmin/logout`                          | —           | Clear the auth cookie                                                  | `superAdmin/auth`     |
| GET    | `/sadmin/profile`                         | Super admin | Get own profile                                                        | `superAdmin/auth`     |
| GET    | `/sadmin/pendingInstitutes`               | Super admin | Institutions awaiting verification                                     | `superAdmin/institute`|
| GET    | `/sadmin/verifiedInstitutes`              | Super admin | Verified institutions                                                  | `superAdmin/institute`|
| PATCH  | `/sadmin/institutes/:institutionId/status`| Super admin | Verify/reject an institution (`{ status }`)                            | `superAdmin/institute`|
| GET    | `/sadmin/pyq-notes`                       | Super admin | List uploaded notes/PYQs for review (paginated, filterable)            | `superAdmin/pyqNotes` |
| POST   | `/sadmin/pyq-notes/upload`                | Super admin | Upload a note/PYQ (multipart `file`)                                   | `superAdmin/pyqNotes` |
| POST   | `/sadmin/pyq-notes/:noteId/verify`        | Super admin | Approve a note and credit the uploader's wallet (`{ amount, description }`) | `superAdmin/pyqNotes` |
| POST   | `/sadmin/pyq-notes/:noteId/reject`        | Super admin | Reject a note (`{ description }`)                                      | `superAdmin/pyqNotes` |
| GET    | `/sadmin/withdrawals`                     | Super admin | List wallet withdrawal requests                                        | `superAdmin/pyqNotes` |
| PATCH  | `/sadmin/withdrawals/:withdrawalId/status`| Super admin | Set status: `PROCESSING` \| `PAID` \| `REJECTED` \| `FAILED`           | `superAdmin/pyqNotes` |

### Teacher (`/teachers`)

**Account**

| Method | Endpoint             | Auth    | Description                                   | File              |
|--------|----------------------|---------|-----------------------------------------------|-------------------|
| POST   | `/teachers/signup`   | —       | Register (pending institute approval)         | `teacher/auth`    |
| POST   | `/teachers/login`    | —       | Log in; returns token + sets cookie           | `teacher/auth`    |
| POST   | `/teachers/logout`   | —       | Clear the auth cookie                         | `teacher/auth`    |
| GET    | `/teachers/profile`  | Teacher | Get own profile                               | `teacher/profile` |
| PATCH  | `/teachers/profile`  | Teacher | Update profile (multipart, optional `profilePicUrl` image) | `teacher/profile` |

**Classes**

| Method | Endpoint                                         | Auth    | Description                                          | File            |
|--------|--------------------------------------------------|---------|------------------------------------------------------|-----------------|
| POST   | `/teachers/class`                                | Teacher | Create a class                                       | `teacher/class` |
| GET    | `/teachers/class`                                | Teacher | List own classes                                     | `teacher/class` |
| PATCH  | `/teachers/class/:classCode`                     | Teacher | Edit class name, room and timings                    | `teacher/class` |
| DELETE | `/teachers/class/:classCode`                     | Teacher | Delete a class                                       | `teacher/class` |
| PATCH  | `/teachers/class/:classCode/toggleStatus`        | Teacher | Toggle a class active/inactive                       | `teacher/class` |
| GET    | `/teachers/class/:classCode/joinedStudentsList`  | Teacher | Enrolled students                                    | `teacher/class` |
| GET    | `/teachers/class/:classCode/pendingStudentsList` | Teacher | Pending join requests                                | `teacher/class` |
| PATCH  | `/teachers/handle-student-request`               | Teacher | Approve or reject a join request                     | `teacher/class` |
| GET    | `/teachers/total-students`                       | Teacher | Total students across own classes                    | `teacher/class` |

**Attendance**

| Method | Endpoint                                               | Auth               | Description                                          | File                 |
|--------|--------------------------------------------------------|--------------------|------------------------------------------------------|----------------------|
| POST   | `/teachers/mark-attendance`                            | Teacher            | Save manual attendance (`classCode`, `date`, `attendance`) | `teacher/attendance` |
| PATCH  | `/teachers/update-attendance`                          | Teacher            | Change one student's status for a date               | `teacher/attendance` |
| GET    | `/teachers/attendance-status/:classCode`               | Teacher            | Today's attendance record for a class                | `teacher/attendance` |
| GET    | `/teachers/class-attendance/:classCode`                | Teacher            | Attendance history of a class                        | `teacher/attendance` |
| GET    | `/teachers/student-attendance/:classCode/:studentId`   | Student or teacher | One student's attendance in a class                  | `teacher/attendance` |
| POST   | `/teachers/enable-attendance`                          | Teacher            | Start a smart attendance session                     | `teacher/attendance` |
| POST   | `/teachers/disable-attendance`                         | Teacher            | Stop the smart attendance session                    | `teacher/attendance` |
| GET    | `/teachers/session-status/:classCode`                  | Teacher            | Whether today's session already exists               | `teacher/attendance` |
| GET    | `/teachers/present-students/:classCode`                | Teacher            | Live list of students marked present in the session  | `teacher/attendance` |

**Notices**

| Method | Endpoint                                 | Auth    | Description                                                        | File             |
|--------|------------------------------------------|---------|--------------------------------------------------------------------|------------------|
| POST   | `/teachers/send-notice`                  | Teacher | Post a notice to a class                                           | `teacher/notice` |
| GET    | `/teachers/notices/:classCode`           | Teacher | Notices of a class                                                 | `teacher/notice` |
| PATCH  | `/teachers/notice/:noticeId`             | Teacher | Edit a class notice                                                | `teacher/notice` |
| DELETE | `/teachers/notice/:noticeId`             | Teacher | Delete a class notice                                              | `teacher/notice` |
| POST   | `/admin/send-general-notice`             | Teacher | Post an institution-wide notice (teacher token, despite the `/admin` path) | `teacher/notice` |
| GET    | `/teachers/general-notices`              | Teacher | General notices of own institution                                 | `teacher/notice` |
| PATCH  | `/teachers/general-notice/:noticeId`     | Teacher | Edit own general notice                                            | `teacher/notice` |
| DELETE | `/teachers/general-notice/:noticeId`     | Teacher | Delete own general notice                                          | `teacher/notice` |

### Student (`/students`)

**Account**

| Method | Endpoint                         | Auth    | Description                                        | File              |
|--------|----------------------------------|---------|----------------------------------------------------|-------------------|
| POST   | `/students/signup`               | —       | Register; sends a verification email               | `student/auth`    |
| GET    | `/students/verify-email?token=`  | —       | Email verification link target                    | `student/auth`    |
| POST   | `/students/resend-verification`  | —       | Resend the verification email                      | `student/auth`    |
| POST   | `/students/login`                | —       | Log in; returns token + sets cookie                | `student/auth`    |
| POST   | `/students/logout`               | —       | Clear the auth cookie                              | `student/auth`    |
| GET    | `/students/profile`              | Student | Get own profile                                    | `student/profile` |
| PATCH  | `/students/profile`              | Student | Update profile (multipart, optional `profilePicUrl` image) | `student/profile` |

**Classes, attendance and notices**

| Method | Endpoint                                  | Auth    | Description                                                  | File                 |
|--------|-------------------------------------------|---------|--------------------------------------------------------------|----------------------|
| POST   | `/students/joinRequests`                  | Student | Request to join a class by code                              | `student/class`      |
| GET    | `/students/ViewJoinRequests`              | Student | Own pending join requests                                    | `student/class`      |
| GET    | `/students/enrolledClasses`               | Student | Classes the student is enrolled in                           | `student/class`      |
| PATCH  | `/students/leaveClass`                    | Student | Leave a class                                                | `student/class`      |
| GET    | `/students/attendance-overall`            | Student | Attendance summary across active classes                     | `student/class`      |
| GET    | `/students/attendance-session/:classCode` | Student | Smart session info (enabled flag, SSID, already marked)      | `teacher/attendance` |
| POST   | `/students/mark-smart-attendance`         | Student | Mark attendance in an active smart session                   | `teacher/attendance` |
| GET    | `/students/notices/:classCode`            | Student | Notices of a class                                           | `teacher/notice`     |
| GET    | `/students/general-notices`               | Student | General notices of own institution                           | `teacher/notice`     |

**Notes, wallet and withdrawals** (open to students and teachers)

| Method | Endpoint                             | Auth               | Description                                                     | File            |
|--------|--------------------------------------|--------------------|-----------------------------------------------------------------|-----------------|
| POST   | `/students/notes/upload`             | Student or teacher | Upload a note/PYQ for review (multipart `file`)                 | `student/notes` |
| GET    | `/students/notes`                    | Student or teacher | Approved notes (query: `course`, `department`, `semester`, `type`) | `student/notes` |
| GET    | `/students/notes/my-uploads`         | Student or teacher | Own uploads and their review status                             | `student/notes` |
| PATCH  | `/students/notes/:noteId/download`   | Student or teacher | Increment a note's download count                               | `student/notes` |
| GET    | `/wallet/balance`                    | Student or teacher | Wallet balance                                                  | `student/notes` |
| GET    | `/wallet/transactions`               | Student or teacher | Wallet transaction history                                      | `student/notes` |
| GET    | `/wallet/withdrawals`                | Student or teacher | Own withdrawal requests                                         | `student/notes` |
| POST   | `/withdrawal/request`                | Student or teacher | Request a payout (minimum amount 10)                            | `student/notes` |

### Dev / testing

Both require a super-admin token.

| Method | Endpoint                    | Auth        | Description                                         | File                |
|--------|-----------------------------|-------------|-----------------------------------------------------|---------------------|
| GET    | `/test-email?email=`        | Super admin | Send a sample verification email                    | `dev/testEmail`     |
| GET    | `/test-verifalia?email=`    | Super admin | Validate an address with Verifalia (uses paid credits) | `dev/verifalia`  |

## DynamoDB tables

| Table                 | Holds                                                      |
|-----------------------|------------------------------------------------------------|
| `Institutions`        | Institution accounts and verification status              |
| `admin`               | Super-admin accounts                                       |
| `teachers`            | Teacher accounts and approval status                       |
| `students`            | Student accounts                                           |
| `classes`             | Classes, enrolled students and join requests               |
| `attendance`          | Attendance records per class per date                      |
| `attendanceSessions`  | Smart attendance sessions                                  |
| `notices`             | Class notices                                              |
| `generalNotices`      | Institution-wide notices                                   |
| `notes`               | Uploaded notes/PYQs and review status                      |
| `noteUnique`          | Uniqueness guard for uploaded notes                        |
| `wallet`              | User wallet balances                                       |
| `walletTransaction`   | Wallet credit/debit history                                |
| `withdrawal`          | Payout withdrawal requests                                 |
| `delete_requests`     | Account deletion requests                                  |

## Deployment notes

- **Entry point:** `src/app.js`. The start command is `npm start` or `node src/app.js`.
- **Port:** `2000` is hard-coded in `src/app.js`.
- **CORS:** allowed origins are listed in `src/app.js` (`presentme.in`, `www.presentme.in`, and localhost `5173`/`5174` for development). Add new frontends there.
- **Region:** some route files create their own DynamoDB client with the region hard-coded to `ap-south-1`, ignoring `AWS_REGION`.
- **Case-sensitive paths:** production runs on Linux, where file names are case-sensitive. A `require()` path must match the file name's case exactly, even though macOS doesn't care.

## Known issues / TODO

- `GET /teachers/student-attendance/:classCode/:studentId` checks that the caller is logged in, but not that the caller owns the data. Any student or teacher can read any student's attendance.
- `react-router-dom` (a frontend library) is still listed in `package.json` but no longer used. Remove it with `npm uninstall react-router-dom`.
- Both `bcrypt` and `bcryptjs` are installed and used in different files.
- Route handlers are written inline in the `*.routes.js` files. Moving them into `controllers/` would make the layers consistent.
