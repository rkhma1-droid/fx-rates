// Exchange rates against the Canadian dollar, from the Bank of Canada Valet API.
// Docs: https://www.bankofcanada.ca/valet/docs
// Each series is named FX<code>CAD, e.g. FXUSDCAD = how many Canadian dollars
// 1 US dollar buys (daily average).

const API_BASE = "https://www.bankofcanada.ca/valet/observations";
const DEFAULT_RANGE_DAYS = 30;
const DEFAULT_CURRENCY = "USD";

// G7 currencies (other than CAD itself) plus the Chinese yuan.
// The Bank of Canada publishes 24 currencies in total; to add another,
// add its code here (the series name is always FX<code>CAD).
const CURRENCIES = {
  USD: "US dollar",
  EUR: "Euro (France, Germany, Italy)",
  GBP: "UK pound sterling",
  JPY: "Japanese yen",
  CNY: "Chinese yuan (renminbi)",
};

const form = document.getElementById("range-form");
const currencySelect = document.getElementById("currency");
const startInput = document.getElementById("start-date");
const endInput = document.getElementById("end-date");
const inverseButton = document.getElementById("inverse-btn");
const refreshButton = document.getElementById("refresh-btn");
const csvButton = document.getElementById("csv-btn");
const excelButton = document.getElementById("excel-btn");
const statusText = document.getElementById("status");
const summary = document.getElementById("summary");
const title = document.getElementById("title");
const rateHeader = document.getElementById("rate-header");
const tableBody = document.getElementById("rates-body");
const seriesName = document.getElementById("series-name");
const chartCanvas = document.getElementById("rate-chart");
const quickRangeButtons = document.querySelectorAll("#quick-ranges button");

let chart = null; // the Chart.js chart, created the first time we draw
let chartUnits = { from: "USD", to: "CAD" }; // what the chart currently shows, for its tooltip

// rates looks like: [{ date: "2026-11-26", toCad: 1.4243 }, ...]
// toCad = how many CAD one unit of the chosen currency buys
let rates = [];
let loadedCurrency = DEFAULT_CURRENCY; // the currency `rates` belongs to
let loadedRange = { start: "", end: "" }; // the dates `rates` covers (used for file names)
let showInverse = false; // false = currency → CAD, true = CAD → currency
let latestRequest = 0; // counts loads, so a slow old answer can't overwrite a newer one

// ---------- Remembering the last currency ----------
// Saved in the browser's localStorage (like the to-do app's tasks).
// Wrapped in try/catch because some browsers block storage, e.g. private windows.

const CURRENCY_KEY = "fx-rates-currency";

function loadSavedCurrency() {
  try {
    const saved = localStorage.getItem(CURRENCY_KEY);
    // Object.hasOwn, not `in`: `in` also says yes to built-in names like "toString"
    return Object.hasOwn(CURRENCIES, saved ?? "") ? saved : DEFAULT_CURRENCY;
  } catch (error) {
    return DEFAULT_CURRENCY;
  }
}

function saveCurrency(code) {
  try {
    localStorage.setItem(CURRENCY_KEY, code);
  } catch (error) {
    // Storage blocked: the page still works, it just won't remember
  }
}

// Fill the dropdown, e.g. "USD – US dollar", and pick the remembered currency
function fillCurrencyList() {
  for (const [code, name] of Object.entries(CURRENCIES)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = `${code} – ${name}`;
    currencySelect.appendChild(option);
  }
  currencySelect.value = loadSavedCurrency();
}

// End = yesterday, moved back past weekends and federal holidays (see holidays.js).
// Start = `days` days ending on that date (the end date counts as one of them).
function setRange(days) {
  const end = defaultEndDate();
  const start = addDays(end, -(days - 1));
  startInput.value = toISODate(start);
  endInput.value = toISODate(end);
  highlightQuickRange();
}

function setDefaultDates() {
  setRange(DEFAULT_RANGE_DAYS);
}

// Light up the quick-range button that matches the dates in the boxes (if any)
function highlightQuickRange() {
  const end = toISODate(defaultEndDate());
  for (const button of quickRangeButtons) {
    const start = toISODate(addDays(defaultEndDate(), -(Number(button.dataset.days) - 1)));
    const matches = startInput.value === start && endInput.value === end;
    button.classList.toggle("active", matches);
  }
}

// ---------- Fetching ----------

// Note: the Bank of Canada publishes ONE daily average rate per business day,
// around 16:30 Eastern time. "Refresh" fetches the newest published data
// (skipping the browser's cache); it is not a live, minute-by-minute price.
async function loadRates() {
  const currency = currencySelect.value;
  const series = `FX${currency}CAD`;
  const start = startInput.value;
  const end = endInput.value;

  if (!start || !end) {
    showStatus("Please pick both a start date and an end date.", true);
    return;
  }
  if (start > end) {
    showStatus("The start date must be on or before the end date.", true);
    return;
  }

  // Give this load a number. If the user clicks again before it finishes,
  // the newer load gets a bigger number and this one's answer is ignored.
  const thisRequest = ++latestRequest;

  showStatus(`Loading ${currency} rates…`);
  setButtonsEnabled(false);

  try {
    const url = `${API_BASE}/${series}/json?start_date=${start}&end_date=${end}`;
    const response = await fetch(url, { cache: "no-store" }); // always ask the Bank, never an old copy
    if (!response.ok) throw new Error(`Bank of Canada returned ${response.status}`);

    const data = await response.json();
    if (thisRequest !== latestRequest) return; // a newer load has started: drop this old answer

    // Each observation is { d: "2026-11-26", FXUSDCAD: { v: "1.4243" } }
    rates = data.observations
      .filter((obs) => obs[series] && obs[series].v)
      .map((obs) => ({ date: obs.d, toCad: Number(obs[series].v) }));
    loadedCurrency = currency;
    loadedRange = { start, end };

    // e.g. "Updated 2:35 p.m."
    const updatedAt = new Date().toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });

    if (rates.length === 0) {
      showStatus(`No rates were published in this date range. (Checked ${updatedAt})`);
    } else {
      showStatus(`${rates.length} business days from ${start} to ${end} · Updated ${updatedAt}`);
    }
  } catch (error) {
    if (thisRequest !== latestRequest) return; // a newer load has started
    rates = [];
    showStatus(`Couldn't load rates: ${error.message}. Check your internet connection and try again.`, true);
  }

  render();
}

// ---------- Showing the data ----------

// The rate in whichever direction is currently selected
function displayedRate(row) {
  return showInverse ? 1 / row.toCad : row.toCad;
}

// Rates range from 0.000078 (rupiah) to 12,800 (CAD in rupiah), so a fixed
// number of decimals doesn't fit all. Big numbers: 4 decimals.
// Small numbers: 4 significant digits (0.7021, 0.008940, 0.00007800).
function formatRate(value) {
  return value >= 1 ? value.toFixed(4) : value.toPrecision(4);
}

function render() {
  const code = loadedCurrency;
  const from = showInverse ? "CAD" : code;
  const to = showInverse ? code : "CAD";

  title.textContent = `${from} → ${to} exchange rates`;
  rateHeader.textContent = `1 ${from} in ${to}`;
  inverseButton.textContent = `Show inverse (${to} → ${from})`;
  seriesName.textContent = `FX${code}CAD`;
  document.title = `${code}/CAD Exchange Rates`;

  // Table: newest date at the top
  tableBody.innerHTML = "";
  [...rates].reverse().forEach((row) => {
    // textContent (not innerHTML) so data from the internet is always shown as plain text
    const tr = document.createElement("tr");
    const dateCell = document.createElement("td");
    const rateCell = document.createElement("td");
    dateCell.textContent = row.date;
    rateCell.textContent = formatRate(displayedRate(row));
    tr.append(dateCell, rateCell);
    tableBody.appendChild(tr);
  });

  // Summary boxes
  if (rates.length === 0) {
    summary.innerHTML = "";
  } else {
    const values = rates.map(displayedRate);
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    summary.innerHTML = `
      <div><span>Latest (${rates[rates.length - 1].date})</span><strong>${formatRate(values[values.length - 1])}</strong></div>
      <div><span>Average</span><strong>${formatRate(average)}</strong></div>
      <div><span>High</span><strong>${formatRate(Math.max(...values))}</strong></div>
      <div><span>Low</span><strong>${formatRate(Math.min(...values))}</strong></div>
    `;
  }

  renderChart(from, to);
  setButtonsEnabled(true);
}

// ---------- Line chart ----------

// "2026-11-26" → "Nov 26"
function shortDate(isoDate) {
  return fromISODate(isoDate).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

// Chart.js doesn't draw a vertical hover line by itself, so this small plugin does
const crosshairPlugin = {
  id: "crosshair",
  afterDatasetsDraw(chartInstance) {
    const active = chartInstance.tooltip && chartInstance.tooltip.getActiveElements();
    if (!active || active.length === 0) return;
    const x = active[0].element.x;
    const { top, bottom } = chartInstance.chartArea;
    const ctx = chartInstance.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#9aa5b1";
    ctx.stroke();
    ctx.restore();
  },
};

function renderChart(from, to) {
  // If Chart.js didn't load (e.g. offline), just hide the chart; the table still works
  if (typeof Chart === "undefined" || rates.length === 0) {
    chartCanvas.parentElement.hidden = true;
    return;
  }
  chartCanvas.parentElement.hidden = false;

  const labels = rates.map((row) => row.date); // oldest → newest, left to right
  const values = rates.map(displayedRate);
  chartUnits = { from, to };

  // Already drawn once? Just swap in the new data and redraw
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.options.plugins.title.text = `1 ${from} in ${to}`;
    chart.update();
    return;
  }

  chart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: "#c8102e", // same red as the buttons
          borderWidth: 2,
          pointRadius: 0, // no dots on every day: cleaner line
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#c8102e",
          pointHoverBorderColor: "white",
          pointHoverBorderWidth: 2,
          tension: 0.2, // slight smoothing
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Hovering anywhere above a date shows that date (no need to hit the line exactly)
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false }, // one line only: the title says what it is
        title: {
          display: true,
          text: `1 ${from} in ${to}`,
          align: "start",
          color: "#3e4c59",
          font: { size: 13, weight: "normal" },
        },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => `1 ${chartUnits.from} = ${formatRate(item.parsed.y)} ${chartUnits.to}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#616e7c",
            maxTicksLimit: 6,
            maxRotation: 0,
            // `this` is the axis; it looks up the date for each tick from the current data
            callback: function (value) {
              return shortDate(this.getLabelForValue(value));
            },
          },
        },
        y: {
          grid: { color: "#eef1f4" },
          border: { display: false },
          ticks: {
            color: "#616e7c",
            maxTicksLimit: 5,
            callback: (value) => formatRate(value),
          },
        },
      },
    },
    plugins: [crosshairPlugin],
  });
}

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function setButtonsEnabled(enabled) {
  const hasData = enabled && rates.length > 0;
  refreshButton.disabled = !enabled; // usable even when the last load failed
  inverseButton.disabled = !hasData;
  csvButton.disabled = !hasData;
  excelButton.disabled = !hasData;
}

// ---------- Downloads ----------

// Rows for the files: oldest first, with both directions so either is handy
function exportRows() {
  const code = loadedCurrency;
  const header = ["Date", `${code} to CAD`, `CAD to ${code}`];
  const rows = rates.map((row) => [
    row.date,
    row.toCad,
    Number((1 / row.toCad).toPrecision(6)),
  ]);
  return [header, ...rows];
}

function fileName(extension) {
  // Use the dates of the data actually shown, not whatever is typed in the boxes now
  return `${loadedCurrency}CAD_${loadedRange.start}_to_${loadedRange.end}.${extension}`;
}

function downloadCsv() {
  const csv = exportRows()
    .map((row) => row.join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

  // Create a temporary link and click it to trigger the download
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName("csv");
  link.click();
  // Free the memory a moment later (doing it instantly can cancel the download in some browsers)
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadExcel() {
  if (typeof XLSX === "undefined") {
    showStatus("The Excel tool didn't load (are you offline?). Try Download CSV instead; Excel opens it too.", true);
    return;
  }
  const sheet = XLSX.utils.aoa_to_sheet(exportRows());
  sheet["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }]; // column widths
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, `${loadedCurrency}-CAD`);
  XLSX.writeFile(book, fileName("xlsx"));
}

// ---------- Wiring up the controls ----------

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadRates();
});

// Picking a different currency remembers it and loads it straight away
currencySelect.addEventListener("change", () => {
  saveCurrency(currencySelect.value);
  loadRates();
});

refreshButton.addEventListener("click", loadRates);

// Quick ranges: set the dates and load straight away
quickRangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setRange(Number(button.dataset.days));
    loadRates();
  });
});

// Typing or picking a date by hand: update which quick-range button is lit
startInput.addEventListener("change", highlightQuickRange);
endInput.addEventListener("change", highlightQuickRange);

inverseButton.addEventListener("click", () => {
  showInverse = !showInverse;
  render();
});

csvButton.addEventListener("click", downloadCsv);
excelButton.addEventListener("click", downloadExcel);

// Start-up: fill in the currency list and default dates, then load straight away
fillCurrencyList();
setDefaultDates();
loadRates();
