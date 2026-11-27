# CAD Exchange Rates

A web page showing daily exchange rates between the Canadian dollar and the other G7 currencies (USD, EUR, GBP, JPY) plus the Chinese yuan (CNY), from the Bank of Canada. US dollar is the default.

## Run it

**Online (any device, including phones):** https://rkhma1-droid.github.io/fx-rates/

**On this computer:** double-click `index.html` to open it in your browser.

Either way it needs an internet connection to fetch the rates.

The online version is published by GitHub Pages from the `main` branch. Pushing a new commit updates it within a minute or two.

## Features

- **Default dates:** the last 30 days, ending yesterday. If yesterday was a weekend or a Canadian federal public holiday, the end date moves back to the most recent working day.
- **Currency picker:** USD, EUR, GBP, JPY or CNY. Changing it reloads the rates, and the page remembers your choice next time.
- **Quick ranges:** 1 week, 30 days, 3 months or 1 year, each ending on the last working day. Data starts on 2017-01-03.
- **Line chart:** the rate over the selected dates. Hover to see each day's value.
- **Refresh button:** fetches the latest published rates again and shows the time of the update. The Bank of Canada publishes one daily average per business day (around 4:30 p.m. ET), so these are not live market prices.
- **Inverse button:** switches between e.g. USD → CAD and CAD → USD.
- **Downloads:** CSV or Excel (.xlsx). Both files include both directions.
- **Summary:** latest, average, high and low for the range.

## Files

- `index.html`: the page layout
- `style.css`: how it looks
- `app.js`: fetching rates, the table, the inverse button and downloads
- `holidays.js`: the federal holiday calendar and the default end-date logic

## Data source

Bank of Canada Valet API, series `FX<code>CAD` (e.g. `FXUSDCAD`, `FXEURCAD`): https://www.bankofcanada.ca/valet/docs
