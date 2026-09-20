"@ngrok/mantle": patch
---

`LineChart.Root` and `AreaChart.Root` now accept `xDomain`, the interval a continuous x axis currently shows, as `[start, end]`. Each end accepts a `number`, a `Date`, or `"auto"`: an explicit end is the exact visual boundary, and a one-sided `"auto"` keeps that end at the data extent. Omitting the prop keeps the full automatic range.

The window applies to the `"linear"` and `"time"` scales only; categorical `"point"` axes ignore it. With a window set, x ticks, line and area projection, the automatic y range, hover and keyboard hit-testing, and the enter/update animation all follow the current interval. The automatic y range fits visible rows only (an explicit `yDomain` still wins, and areas keep the zero baseline). Segments that cross a window boundary clip exactly on the edge in both the normal and the high-density decimated paths, and a tooltip, marker, or active index the new window hides clears on the switch. No data cropping is needed: pass the full `data` array and change `xDomain` to move the window.
