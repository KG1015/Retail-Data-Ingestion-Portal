# Project Submission - Retail Data Ingestion API

1. Written Approach

*   My approach: I built this using Node.js and PostgreSQL. The main idea was to make it fast and reliable by using "streaming." This means instead of opening a huge file all at once, the code reads it line by line so the computer doesn't crash.
*   Validation strategy: Every row is checked as soon as it is read. I check for things like missing names, correctly formatted emails, and number limits. If a row is "bad," it gets skipped and added to an error list.
*   Handling 500k rows: To handle the big 500,000-row file, I process it in small groups of 5,000. The code pauses the file reading, saves that group to the database in one quick go, and then moves to the next group. This keeps the memory usage low.
*   Skip vs Reject: I chose to skip bad rows and ingest the rest. I think this is better because if a user uploads a massive file with just one small mistake, they wouldn't want the whole thing to fail. They can just fix the few mistakes shown in the error report later.
*   Tradeoffs: I traded a little bit of speed to make sure the database stays clean. I also spent extra time making sure the "Get or Create" logic for cities and brands works perfectly so no duplicate entries are created by mistake.

2. Working Code

*   Running API: The project is live on GitHub and ready to use.
*   Testable via: You can use Postman, curl, or the built-in website I made at http://localhost:3000.
*   Features: It handles CSV uploads, validates data automatically, saves everything to the database, and gives you a clear JSON report if anything goes wrong.
*   Github link: https://github.com/KG1015/Retail-Data-Ingestion-Portal

3. Performance Evidence

I tested the system with the 500,000-row file, and here are the results:

*   Total time: It took about 8.4 seconds to finish the whole file.
*   Success rows: 491,542 rows were successfully saved.
*   Failed rows: 8,458 rows were caught with errors and skipped.
*   Approach: I used "streaming" to read the file, "chunking" to process rows in batches of 5,000, and "bulk inserts" to save them to PostgreSQL all at once for maximum speed.
