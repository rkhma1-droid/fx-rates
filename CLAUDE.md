# Project notes for Claude

- Beginner's project: explain changes in simple terms.
- Plain HTML/CSS/JS, no build step. Only outside script: SheetJS (xlsx) from cdnjs for the Excel download.
- Rates come from the Bank of Canada Valet API (https://www.bankofcanada.ca/valet/docs), series FX<code>CAD (G7 currencies USD, EUR, GBP, JPY plus CNY, per the user's choice; list in app.js `CURRENCIES`; default USD). Values are "CAD per 1 unit of foreign currency".
- Default end date = yesterday, moved back past weekends and Canadian federal public holidays (holidays.js). Default start = 30 days ending on the end date.
- Dates are handled as local "YYYY-MM-DD" strings. Avoid `toISOString()`, which converts to UTC and can shift the day.
