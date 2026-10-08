# School Accountant – Income & Expense Manager

A lightweight, single-page web application designed for school accountants to easily manage daily income and expense transactions.

## Features

- **Dashboard:** Overview of income, expenses, and current balance.
- **Transaction Management:** Add, view, and manage daily income and expenses.
- **Student Directory:** Track student-related financial records and fee payments.
- **Bulk Entry:** Fast and easy bulk transaction entry using tables.
- **Cloud Sync:** Uses Supabase for database and authentication.
- **Export/Import:** Supports CSV parsing via PapaParse.

## Technology Stack

- HTML5, CSS3, JavaScript
- Supabase JS SDK (Database & Authentication)
- PapaParse (CSV Processing)

## Setup

1. Configure your `.env` file with your Supabase credentials:
   ```env
   SUPABASE_URL="https://your-project.supabase.co"
   SUPABASE_ANON_KEY="your-anon-key"
   ```
2. Serve and open `index.html` in your browser (via VS Code Live Preview or any local web server).

## License

MIT License