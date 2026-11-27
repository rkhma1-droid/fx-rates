# Project notes for Claude

- Beginner's project: explain changes in simple terms.
- Plain HTML/CSS/JS, no build step. Only outside script: SheetJS (xlsx) from cdnjs for the Excel download.
- Rates come from the Bank of Canada Valet API (https://www.bankofcanada.ca/valet/docs), series FX<code>CAD (G7 currencies USD, EUR, GBP, JPY plus CNY and HKD, per the user's choice; list in app.js `CURRENCIES`; default USD). Values are "CAD per 1 unit of foreign currency".
- Default end date = yesterday, moved back past weekends and Canadian federal public holidays (holidays.js). Default start = 30 days ending on the end date.
- RELEASE RULE: the site is installed as an app on the user's phone. Whenever style.css, holidays.js or app.js change, bump the `?v=` tag on all three in index.html (e.g. `?v=2026-11-27.3`). Without it, browsers reuse old copies (GitHub Pages sends max-age=600) and the phone won't see the change. sw.js always re-checks the page itself (`cache: "no-cache"`); if sw.js's APP_FILES or caching logic changes, bump CACHE_NAME too.
- Dates are handled as local "YYYY-MM-DD" strings. Avoid `toISOString()`, which converts to UTC and can shift the day.
