// Benchmark preload: observe the existing server without creating an app or network listener.
function measure(final = false): void {
  if (process.connected) {
    process.send?.(
      {
        event: "memory",
        entrypoint: process.argv[1],
        rssBytes: process.memoryUsage().rss,
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
        final,
      },
      () => undefined,
    );
  }
}

const timer = setInterval(measure, 25);
timer.unref();
process.on("message", (message: unknown) => {
  if (message === "measure") measure(true);
});
// Observation must not keep the application alive after its own shutdown completes.
process.channel?.unref();
process.once("disconnect", () => clearInterval(timer));
