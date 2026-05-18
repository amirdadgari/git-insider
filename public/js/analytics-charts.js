// Chart.js-powered analytics visualizations (theme-aware)
(function () {
    const COLORS = {
        blue: '#0366d6',
        purple: '#6f42c1',
        green: '#28a745',
        red: '#d73a49'
    };

    const charts = [];

    function isDark() {
        return document.documentElement.classList.contains('dark');
    }

    function theme() {
        const dark = isDark();
        return {
            text: dark ? '#8b949e' : '#6b7280',
            textStrong: dark ? '#f0f6fc' : '#111827',
            grid: dark ? 'rgba(240,246,252,0.06)' : 'rgba(0,0,0,0.06)',
            tooltipBg: dark ? '#21262d' : '#ffffff',
            tooltipBorder: dark ? '#30363d' : '#e5e7eb'
        };
    }

    function destroyAll() {
        while (charts.length) {
            const c = charts.pop();
            try { c.destroy(); } catch (_) {}
        }
    }

    function track(chart) {
        charts.push(chart);
        return chart;
    }

    function fmtNum(n) {
        return Number(n || 0).toLocaleString();
    }

    function parseLocalDate(ymd) {
        const [y, m, d] = (ymd || '').split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    }

    function formatYmd(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function shortLabel(ymd) {
        const d = parseLocalDate(ymd);
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function fillDailySeries(buckets, startDate, endDate, defaults) {
        const map = new Map((buckets || []).map((b) => [b.bucket, b]));
        const labels = [];
        const rows = [];
        if (!startDate || !endDate) {
            (buckets || []).forEach((b) => {
                labels.push(shortLabel(b.bucket));
                rows.push({ ...defaults, ...b, bucket: b.bucket });
            });
            return { labels, rows };
        }
        let cur = parseLocalDate(startDate);
        const end = parseLocalDate(endDate);
        while (cur <= end) {
            const key = formatYmd(cur);
            const row = map.get(key) || { bucket: key, ...defaults };
            labels.push(shortLabel(key));
            rows.push(row);
            cur.setDate(cur.getDate() + 1);
        }
        return { labels, rows };
    }

    function baseOptions(t) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: t.text, boxWidth: 12, padding: 14, font: { size: 11 } }
                },
                tooltip: {
                    backgroundColor: t.tooltipBg,
                    titleColor: t.textStrong,
                    bodyColor: t.text,
                    borderColor: t.tooltipBorder,
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    ticks: { color: t.text, maxRotation: 45, minRotation: 0, font: { size: 10 } },
                    grid: { color: t.grid, drawBorder: false }
                },
                y: {
                    ticks: { color: t.text, font: { size: 10 } },
                    grid: { color: t.grid, drawBorder: false },
                    beginAtZero: true
                }
            }
        };
    }

    function renderCommitsChart(canvas, buckets, startDate, endDate) {
        const t = theme();
        const { labels, rows } = fillDailySeries(buckets, startDate, endDate, { count: 0 });
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(3, 102, 214, 0.9)');
        gradient.addColorStop(1, 'rgba(111, 66, 193, 0.35)');

        return track(new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Commits',
                    data: rows.map((r) => r.count || 0),
                    backgroundColor: gradient,
                    borderColor: COLORS.blue,
                    borderWidth: 1,
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                ...baseOptions(t),
                plugins: {
                    ...baseOptions(t).plugins,
                    legend: { display: false },
                    tooltip: {
                        ...baseOptions(t).plugins.tooltip,
                        callbacks: {
                            label: (ctx) => ` ${fmtNum(ctx.parsed.y)} commits`
                        }
                    }
                }
            }
        }));
    }

    function renderLinesChart(canvas, buckets, startDate, endDate) {
        const t = theme();
        const { labels, rows } = fillDailySeries(buckets, startDate, endDate, { additions: 0, deletions: 0 });

        return track(new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Lines added',
                        data: rows.map((r) => r.additions || 0),
                        backgroundColor: 'rgba(40, 167, 69, 0.8)',
                        borderColor: COLORS.green,
                        borderWidth: 1,
                        borderRadius: 4,
                        stack: 'lines'
                    },
                    {
                        label: 'Lines deleted',
                        data: rows.map((r) => r.deletions || 0),
                        backgroundColor: 'rgba(215, 58, 73, 0.8)',
                        borderColor: COLORS.red,
                        borderWidth: 1,
                        borderRadius: 4,
                        stack: 'lines'
                    }
                ]
            },
            options: {
                ...baseOptions(t),
                scales: {
                    ...baseOptions(t).scales,
                    x: { ...baseOptions(t).scales.x, stacked: true },
                    y: { ...baseOptions(t).scales.y, stacked: true }
                },
                plugins: {
                    ...baseOptions(t).plugins,
                    tooltip: {
                        ...baseOptions(t).plugins.tooltip,
                        callbacks: {
                            footer: (items) => {
                                const add = items.find((i) => i.dataset.label === 'Lines added')?.parsed?.y || 0;
                                const del = items.find((i) => i.dataset.label === 'Lines deleted')?.parsed?.y || 0;
                                return `Net: ${fmtNum(add - del)}`;
                            }
                        }
                    }
                }
            }
        }));
    }

    function renderHorizontalRankChart(canvas, items, labelKey, countKey, barColor) {
        const t = theme();
        const top = (items || []).slice(0, 8);
        const labels = top.map((i) => {
            const name = String(i[labelKey] || 'Unknown');
            return name.length > 28 ? `${name.slice(0, 26)}…` : name;
        });
        const values = top.map((i) => i[countKey] || 0);

        return track(new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Commits',
                    data: values,
                    backgroundColor: barColor,
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: t.tooltipBg,
                        titleColor: t.textStrong,
                        bodyColor: t.text,
                        borderColor: t.tooltipBorder,
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => ` ${fmtNum(ctx.parsed.x)} commits`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: t.text, font: { size: 10 } },
                        grid: { color: t.grid, drawBorder: false },
                        beginAtZero: true
                    },
                    y: {
                        ticks: { color: t.textStrong, font: { size: 11 } },
                        grid: { display: false }
                    }
                }
            }
        }));
    }

    function chartCard(title, canvasId, subtitle, { tall = false } = {}) {
        const sub = subtitle
            ? `<p class="text-xs text-gray-500 dark:text-dark-text-secondary mt-0.5">${subtitle}</p>`
            : '';
        const wrapClass = tall
            ? 'analytics-chart-wrap analytics-chart-wrap--tall'
            : 'analytics-chart-wrap';
        return `
            <div class="card analytics-chart-card">
                <div class="mb-3">
                    <h3 class="card-title">${title}</h3>
                    ${sub}
                </div>
                <div class="${wrapClass}">
                    <canvas id="${canvasId}" role="img" aria-label="${title}"></canvas>
                </div>
            </div>
        `;
    }

    function mountAll(data, { startDate, endDate }) {
        if (typeof Chart === 'undefined') return;

        const commitsCanvas = document.getElementById('chart-commits');
        const linesCanvas = document.getElementById('chart-lines');
        const contribCanvas = document.getElementById('chart-contributors');
        const reposCanvas = document.getElementById('chart-repositories');

        if (commitsCanvas && (data.commitsOverTime || []).length) {
            renderCommitsChart(commitsCanvas, data.commitsOverTime, startDate, endDate);
        }
        if (linesCanvas && (data.linesOverTime || []).length) {
            renderLinesChart(linesCanvas, data.linesOverTime, startDate, endDate);
        }
        if (contribCanvas && (data.topContributors || []).length) {
            renderHorizontalRankChart(
                contribCanvas,
                data.topContributors,
                'name',
                'commit_count',
                'rgba(3, 102, 214, 0.75)'
            );
        }
        if (reposCanvas && (data.topRepositories || []).length) {
            renderHorizontalRankChart(
                reposCanvas,
                data.topRepositories,
                'name',
                'commit_count',
                'rgba(111, 66, 193, 0.75)'
            );
        }
    }

    function bindThemeRefresh(rerender) {
        if (window._analyticsThemeObserver) return;
        window._analyticsThemeObserver = new MutationObserver(() => {
            const page = document.getElementById('analytics-page');
            if (page && !page.classList.contains('hidden')) {
                rerender();
            }
        });
        window._analyticsThemeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    window.analyticsCharts = {
        COLORS,
        fmtNum,
        destroyAll,
        chartCard,
        mountAll,
        bindThemeRefresh,
        fillDailySeries
    };
})();
