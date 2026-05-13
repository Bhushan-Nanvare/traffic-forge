/**
 * PDF report generator — turns a TestReport + RCAReports + bottlenecks
 * into a printable, stakeholder-friendly PDF.
 *
 * Uses PDFKit. The result is streamed directly to the response so we
 * don't buffer multi-megabyte reports in memory.
 */
import PDFDocument from 'pdfkit';
import type { Writable } from 'stream';
import type { TestReport, BugReport } from '../types/report.js';
import type { RCAReport } from '../types/rca.js';
import type { BottleneckReport } from '../types/bottleneck.js';

export interface ReportPdfInput {
  report: TestReport;
  rcaReports?: RCAReport[];
  bottlenecks?: BottleneckReport[];
  costUsd?: number;
}

const COLORS = {
  primary: '#2563eb',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  high: '#dc2626',
  medium: '#d97706',
  low: '#059669',
} as const;

/**
 * Stream a PDF report to `out`. Callers typically pipe the api-server
 * response into this; PDFKit ends the stream automatically when done().
 */
export function streamReportPdf(input: ReportPdfInput, out: Writable): void {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `TrafficForge Report — ${input.report.url}`,
      Author: 'TrafficForge',
      CreationDate: new Date(input.report.generatedAt),
    },
  });

  doc.pipe(out);

  drawCover(doc, input);
  drawSummary(doc, input);
  drawBugs(doc, input.report.bugs);
  if (input.rcaReports && input.rcaReports.length > 0) {
    drawRCA(doc, input.rcaReports);
  }
  if (input.bottlenecks && input.bottlenecks.length > 0) {
    drawBottlenecks(doc, input.bottlenecks);
  }
  drawRecommendations(doc, input.report.recommendations);

  doc.end();
}

// ─── Sections ────────────────────────────────────────────────────────────────

function drawCover(doc: PDFKit.PDFDocument, input: ReportPdfInput): void {
  doc.fontSize(28).fillColor(COLORS.primary).text('TrafficForge Report', { align: 'left' });

  doc.moveDown(0.3);
  doc.fontSize(14).fillColor(COLORS.muted).text(input.report.url);
  doc.fontSize(10).text(`App type: ${input.report.appType}`);
  doc.text(`Generated: ${new Date(input.report.generatedAt).toISOString()}`);
  if (input.costUsd != null) {
    doc.text(`AI analysis cost: $${input.costUsd.toFixed(4)}`);
  }

  doc.moveDown(2);
}

function drawSummary(doc: PDFKit.PDFDocument, input: ReportPdfInput): void {
  sectionHeading(doc, 'Summary');
  doc.fontSize(11).fillColor(COLORS.text).text(input.report.summary, { align: 'left' });

  doc.moveDown(0.5);
  const m = input.report.metrics;
  doc.fontSize(10).fillColor(COLORS.muted);
  doc.text(`Total events: ${m.totalEvents}    Failed: ${m.failedEvents}    Avg duration: ${m.avgDuration}ms    Test duration: ${m.testDurationMs}ms`);
  doc.moveDown(1);
}

function drawBugs(doc: PDFKit.PDFDocument, bugs: BugReport[]): void {
  sectionHeading(doc, `Detected Bugs (${bugs.length})`);
  if (bugs.length === 0) {
    doc.fontSize(11).fillColor(COLORS.muted).text('No bugs detected — your app looks healthy under load.');
    doc.moveDown(1);
    return;
  }

  for (const item of bugs) {
    ensureSpace(doc, 120);
    const sevColor = COLORS[item.bug.severity];

    doc.fontSize(12).fillColor(sevColor).text(`[${item.bug.severity.toUpperCase()}] ${item.bug.title}`);
    doc.fontSize(9).fillColor(COLORS.muted).text(`Type: ${item.bug.type}    Confidence: ${(item.bug.confidence * 100).toFixed(0)}%`);

    doc.fontSize(10).fillColor(COLORS.text);
    doc.moveDown(0.2).text(item.bug.description, { align: 'left' });

    if (item.rootCause) {
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor(COLORS.muted).text('Root cause:', { continued: false });
      doc.fontSize(10).fillColor(COLORS.text).text(item.rootCause);
    }
    if (item.suggestedFix) {
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor(COLORS.muted).text('Suggested fix:', { continued: false });
      doc.fontSize(10).fillColor(COLORS.text).text(item.suggestedFix);
    }
    if (item.reproductionSteps && item.reproductionSteps.length > 0) {
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor(COLORS.muted).text('Reproduction steps:');
      doc.fontSize(10).fillColor(COLORS.text);
      for (let i = 0; i < item.reproductionSteps.length; i++) {
        doc.text(`  ${i + 1}. ${item.reproductionSteps[i]}`);
      }
    }

    doc.moveDown(0.5);
    drawDivider(doc);
  }
}

function drawRCA(doc: PDFKit.PDFDocument, rcaReports: RCAReport[]): void {
  sectionHeading(doc, `Root Cause Analysis (${rcaReports.length})`);

  for (const rca of rcaReports) {
    ensureSpace(doc, 200);
    doc.fontSize(12).fillColor(COLORS.primary).text(rca.rootCause);
    doc.fontSize(9).fillColor(COLORS.muted).text(`Confidence: ${(rca.confidence * 100).toFixed(0)}%`);
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(COLORS.text).text(rca.hypothesis);

    if (rca.causalChain.length > 0) {
      doc.moveDown(0.4);
      doc.fontSize(9).fillColor(COLORS.muted).text('Causal chain:');
      doc.fontSize(10).fillColor(COLORS.text);
      for (const step of rca.causalChain) {
        doc.text(`  ${step.step}. [${step.type}] ${step.description}`);
      }
    }

    if (rca.alternatives && rca.alternatives.length > 0) {
      doc.moveDown(0.4);
      doc.fontSize(9).fillColor(COLORS.muted).text('Alternative hypotheses:');
      for (const alt of rca.alternatives) {
        doc.fontSize(10).fillColor(COLORS.text).text(`  ${alt.rank}. ${alt.rootCause} (${(alt.confidence * 100).toFixed(0)}%)`);
        doc.fontSize(9).fillColor(COLORS.muted).text(`     ${alt.rationale}`, { indent: 0 });
      }
    }

    if (rca.recommendations.length > 0) {
      doc.moveDown(0.4);
      doc.fontSize(9).fillColor(COLORS.muted).text('Recommendations:');
      doc.fontSize(10).fillColor(COLORS.text);
      for (const rec of rca.recommendations) {
        doc.text(`  • [${rec.priority.toUpperCase()}] ${rec.action}`);
      }
    }

    doc.moveDown(0.6);
    drawDivider(doc);
  }
}

function drawBottlenecks(doc: PDFKit.PDFDocument, bottlenecks: BottleneckReport[]): void {
  sectionHeading(doc, `Performance Bottlenecks (${bottlenecks.length})`);

  for (const b of bottlenecks) {
    ensureSpace(doc, 80);
    const sevColor = COLORS[b.severity];
    doc.fontSize(11).fillColor(sevColor).text(`[${b.severity.toUpperCase()}] ${b.description}`);
    doc.fontSize(9).fillColor(COLORS.muted).text(`Category: ${b.category}    ${b.metric}: ${b.observed} (threshold: ${b.threshold})`);

    if (b.evidence.length > 0) {
      doc.fontSize(9).fillColor(COLORS.text);
      for (const e of b.evidence) {
        doc.text(`  • ${e}`);
      }
    }

    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(COLORS.text).text(`→ ${b.recommendation}`);
    doc.moveDown(0.6);
  }
}

function drawRecommendations(doc: PDFKit.PDFDocument, recommendations: string[]): void {
  if (recommendations.length === 0) return;
  sectionHeading(doc, 'Top Recommendations');
  doc.fontSize(10).fillColor(COLORS.text);
  for (let i = 0; i < recommendations.length; i++) {
    ensureSpace(doc, 30);
    doc.text(`${i + 1}. ${recommendations[i]}`);
    doc.moveDown(0.3);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sectionHeading(doc: PDFKit.PDFDocument, text: string): void {
  ensureSpace(doc, 60);
  doc.moveDown(0.4);
  doc.fontSize(16).fillColor(COLORS.primary).text(text);
  doc.moveDown(0.3);
  drawDivider(doc);
  doc.moveDown(0.3);
}

function drawDivider(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(COLORS.border).lineWidth(0.5).stroke();
  doc.moveDown(0.3);
}

/** Add a page break if remaining space is less than `needed` points. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}
