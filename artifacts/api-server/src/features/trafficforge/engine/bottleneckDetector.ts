/**
 * Bottleneck Detector — finds slow endpoints, resource exhaustion, and
 * timing patterns that indicate performance bottlenecks.
 *
 * Uses HDR Histogram for percentile computation: O(1) memory, accurate at
 * tails, scales to millions of samples without performance degradation.
 */
import * as hdr from 'hdr-histogram-js';
import type { BottleneckReport, BottleneckContext, PercentileStats } from '../types/bottleneck.js';

export class BottleneckDetector {
  detectAll(ctx: BottleneckContext): BottleneckReport[] {
    return [
      ...this.detectSlowEndpoints(ctx),
      ...this.detectResourceBottlenecks(ctx),
      ...this.detectTimingTrends(ctx),
      ...this.detectConnectionPoolExhaustion(ctx),
    ];
  }

  private detectSlowEndpoints(ctx: BottleneckContext): BottleneckReport[] {
    const reports: BottleneckReport[] = [];
    for (const ep of ctx.endpointStats) {
      if (ep.percentiles.p95 > 1000) {
        reports.push({
          id: `slow-${ep.path}`,
          category: 'network',
          severity: ep.percentiles.p95 > 3000 ? 'high' : 'medium',
          description: `Endpoint ${ep.path} is slow (p95 > 1s)`,
          metric: 'p95_latency_ms',
          threshold: 1000,
          observed: ep.percentiles.p95,
          evidence: [
            `p50: ${ep.percentiles.p50}ms`,
            `p95: ${ep.percentiles.p95}ms`,
            `p99: ${ep.percentiles.p99}ms`,
          ],
          recommendation: 'Profile the endpoint, check database queries, add caching',
          detectedAt: Date.now(),
        });
      }
    }
    return reports;
  }

  private detectResourceBottlenecks(ctx: BottleneckContext): BottleneckReport[] {
    const reports: BottleneckReport[] = [];
    const r = ctx.resourceStats;
    if (!r) return reports;

    if (r.cpuPercent > 80) {
      reports.push({
        id: 'cpu-high',
        category: 'cpu',
        severity: r.cpuPercent > 95 ? 'high' : 'medium',
        description: 'CPU utilization is high',
        metric: 'cpu_percent',
        threshold: 80,
        observed: r.cpuPercent,
        evidence: [`CPU: ${r.cpuPercent.toFixed(1)}%`],
        recommendation: 'Profile hot code paths, consider scaling out',
        detectedAt: Date.now(),
      });
    }

    if (r.memoryMB > 1500) {
      reports.push({
        id: 'memory-high',
        category: 'memory',
        severity: r.memoryMB > 3000 ? 'high' : 'medium',
        description: 'Memory usage is high',
        metric: 'memory_mb',
        threshold: 1500,
        observed: r.memoryMB,
        evidence: [`Heap: ${r.memoryMB}MB`],
        recommendation: 'Check for memory leaks, review caching policies',
        detectedAt: Date.now(),
      });
    }
    return reports;
  }

  private detectTimingTrends(ctx: BottleneckContext): BottleneckReport[] {
    if (ctx.events.length < 20) return [];
    const sorted = [...ctx.events].sort((a, b) => a.timestamp - b.timestamp);
    const half = Math.floor(sorted.length / 2);
    const firstAvg = avg(sorted.slice(0, half).map((e) => e.duration));
    const secondAvg = avg(sorted.slice(half).map((e) => e.duration));
    if (secondAvg > firstAvg * 1.5) {
      return [
        {
          id: 'degradation-trend',
          category: 'database',
          severity: 'high',
          description: 'Performance degrading over time',
          metric: 'avg_duration_growth',
          threshold: 1.5,
          observed: secondAvg / firstAvg,
          evidence: [
            `First half avg: ${firstAvg.toFixed(0)}ms`,
            `Second half avg: ${secondAvg.toFixed(0)}ms`,
          ],
          recommendation: 'Likely DB index issue or connection pool draining',
          detectedAt: Date.now(),
        },
      ];
    }
    return [];
  }

  private detectConnectionPoolExhaustion(ctx: BottleneckContext): BottleneckReport[] {
    if (!ctx.resourceStats) return [];
    if (ctx.resourceStats.inFlight > 100) {
      return [
        {
          id: 'pool-exhaustion',
          category: 'connection_pool',
          severity: 'high',
          description: 'Connection pool likely exhausted',
          metric: 'in_flight',
          threshold: 100,
          observed: ctx.resourceStats.inFlight,
          evidence: [`In-flight requests: ${ctx.resourceStats.inFlight}`],
          recommendation: 'Increase pool size or add backpressure',
          detectedAt: Date.now(),
        },
      ];
    }
    return [];
  }

  /**
   * Compute percentiles using HDR Histogram — O(1) memory, accurate at extreme tails.
   *
   * HDR Histogram (High Dynamic Range) uses logarithmic bucketing so the
   * memory footprint is independent of input size, and tail percentiles
   * (p99, p99.9) are precise even with millions of samples — a massive
   * improvement over sorting the full array, which is O(n log n) time
   * and O(n) memory.
   *
   * Range: 1µs to 1 hour, 3 significant digits of precision.
   */
  computePercentiles(values: number[]): PercentileStats {
    if (values.length === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    const histogram = hdr.build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: 3_600_000_000, // 1 hour in microseconds
      numberOfSignificantValueDigits: 3,
      bitBucketSize: 32,
      autoResize: true,
    });

    let sum = 0;
    for (const v of values) {
      // HDR Histogram requires positive integers; clamp to >= 1
      const sample = Math.max(1, Math.round(v));
      histogram.recordValue(sample);
      sum += v;
    }

    const stats: PercentileStats = {
      p50: histogram.getValueAtPercentile(50),
      p95: histogram.getValueAtPercentile(95),
      p99: histogram.getValueAtPercentile(99),
      min: histogram.minNonZeroValue,
      max: histogram.maxValue,
      avg: sum / values.length,
    };

    histogram.destroy();
    return stats;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
