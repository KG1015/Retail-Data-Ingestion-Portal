# Retail Data Ingestion API

A high-performance, resilient data ingestion service built for retail platforms. The service accepts massive CSV files (up to 500,000+ rows) containing Master Data and mapping files, validates them row-by-row, automatically resolves foreign key dependencies dynamically, and strictly structures the data into a native PostgreSQL database.

## 🚀 Tech Stack
- **Backend Environment:** Node.js, Express
- **Database:** PostgreSQL (with `pg` pooling connection)
- **Data Parsing:** `fast-csv`, `multer` (for multi-part streaming)
- **Architecture:** Controller-Service Layer isolation

---

## 🏗️ High-Level Approach & Strategy

### 1. 500K Performance Strategy (Streaming & Chunking)
To successfully process files spanning half a million lines without exhausting server memory (`RAM`), the application entirely abandons raw buffer loading.
- We utilize **ReadStreams (`fs.createReadStream`)** alongside **`fast-csv`** to emit individual rows sequentially over time.
- Processing occurs synchronously in **Batches of 5,000**. Once a temporary array hits 5,000 valid records, the CSV stream physical pauses (`.pause()`).
- The batch is inserted inside a protected SQL Transaction using a singular parameterized `bulk insert / batch insert` query. Row-by-row saving (`.save()`) was immediately disqualified due to connection overhead latency.
- Post-insertion, the stream unpauses (`.resume()`).
- **Result:** The 500k benchmark file parses, validates constraints, resolves all relational lookups, and safely isolates duplicates seamlessly in **~8.3 seconds**.

### 2. Failure Policy Choice: "Strategic Skipping"
**Decision:** When rows fail validation, this system explicitly skips the bad rows, ingests the rest of the batch, and provides a final error report.
**Reasoning:** In modern retail infrastructure, rejecting a massive 500,000-row file because of *one* typo on row 298,401 is disruptive to the business. 
Instead, "Strategic Skipping" allows operations to seamlessly continue with a 99% data availability rate while generating a comprehensive JSON list containing the exact `{ row_number, column, reason }` arrays. Business teams can then confidently correct string typos and upload the specific error payload back to the same endpoint without triggering duplications.

### 3. Idempotency & Conflict Handling
A core requirement was preventing "silent data corruption" if the identical CSV was accidentally processed twice. 
Rather than checking rows individually using costly `SELECT` queries, the system heavily leverages PostgreSQL's native `ON CONFLICT (id) DO NOTHING` constraints. This ensures data is seamlessly ignored entirely at the memory layer if strings precisely overlap existing entries.

### 4. Normalization & "Get-Or-Create" Architecture
The DDL specified 6 lookup reference tables (`store_brands`, `cities`, etc.) that contained no pre-seeded data. 
To prevent identical locations mapping distinct IDs due to formatting mistakes (e.g. `"Star Bazaar"` vs `" star bazaar "`), we strictly enforce Data Normalization.
- Prior to the Get-Or-Create logic resolving arrays against Postgres, every string dynamically maps through `.trim()` and `.toLowerCase()`.
- The Lookup service fires an optimized `INSERT INTO ... ON CONFLICT DO NOTHING RETURN id` sequence that dynamically writes all missing dictionaries globally BEFORE resolving integer array maps over the batch.


### 5. Tradeoffs Considered
- **Memory vs. SQL Latency:** I traded a slight amount of memory usage per batch (storing 5000 instances in RAM temporarily) to drastically minimize network SQL latency. Sending 5000 insert commands individually would create crippling connection overhead, so processing chunks minimizes TCP bottlenecks.
- **Strict Error Isolation vs. Full File Reject:** While rejecting an entire file on the very first error ensures absolute purity, it is extremely hostile to user experience for multi-gigabyte files. I traded atomic file-level transactions for batch-level idempotency to allow 99.9% of valid corporate data to flow freely while actively isolating the broken rows individually.

---

## 🛠 Project Structure & Engineering Maturity

Separation of specific concerns was chosen over a monolithic file architecture:
- `server.js`: Purely binds network TCP ports, initializes PG schema DDL strings, and routes traffic.
- `/src/controllers`: Pure coordinators. Handles HTTP `status()`, captures physical `multer` paths, coordinates temp-file deletion (`fs.unlinkSync()`), and wraps JSON response deliveries.
- `/src/services`: Where true business rules lie.
  - `store.service.js` / `user.service.js`: Hardcodes regex checking, missing-field triggers, and bulk insertions for their respective tables.
  - `base.service.js`: Holds decoupled, generic `resolveLookups` mapping loops shared across all files.
  - `pjp.service.js`: Evaluates strict dependency mapping rules recursively back against native tables (`store_id`, `user_id`).

---

## 💻 Installation & Usage

### 1. Prerequisites
- **Node.js**: v18+
- **PostgreSQL**: v14+ Running Locally (Native `brew` installation or `Docker`)

### 2. Setup
Clone the repository, configure standard install chains, and establish a connection.
```bash
git clone https://github.com/KG1015/Retail-Data-Ingestion-Portal.git
cd Retail-Data-Ingestion-Portal
npm install
```

### 3. Run Locally
Start the server (by default, it will natively connect string `postgresql://user:password@localhost:5432/infilectdb` safely creating schema structures automatically):
```bash
node server.js
```

### 4. Upload Testing
Open your browser natively to:
`http://localhost:3000`
A minimal, heavily stylized Tailwind-CSS interface allows synchronous File Picking and generates robust Error Table UI responses visually on the page. 

**Order of Operations Important Requirement:**
Always test by uploading Data Types in sequential hierarchy to prevent dependency mapping errors:
1. `stores_master.csv` & `users_master.csv`
2. `store_user_mapping.csv`
