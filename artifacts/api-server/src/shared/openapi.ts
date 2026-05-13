/**
 * OpenAPI 3.1 spec for the TrafficForge HTTP API.
 *
 * Hand-authored to keep the spec readable, but the request body schemas
 * mirror the Zod validators in router.ts so the contract stays in sync.
 *
 * Served at:
 *   GET /api/openapi.json — machine-readable spec
 *   GET /api/docs         — Swagger UI (interactive)
 */

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'TrafficForge API',
    version: '1.0.0',
    description:
      'Intelligent load testing platform: scan a URL, run concurrent agents, ' +
      'analyse the results with AI to detect race conditions, persistence failures, ' +
      'and performance bottlenecks.',
  },
  servers: [{ url: '/api', description: 'Base API path' }],
  tags: [
    { name: 'health', description: 'Service health' },
    { name: 'scanner', description: 'Discover URLs and forms on a target site' },
    { name: 'configs', description: 'Reusable test configurations' },
    { name: 'runs', description: 'Test run lifecycle (create, start, stop)' },
    { name: 'analysis', description: 'AI-powered bug detection and reporting' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['health'],
        summary: 'Service health check',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    service: { type: 'string', example: 'trafficforge-backend' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/active-runs': {
      get: {
        tags: ['runs'],
        summary: 'List currently running test runs',
        responses: {
          '200': {
            description: 'Array of active runs',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ActiveRun' },
                },
              },
            },
          },
        },
      },
    },
    '/scan': {
      post: {
        tags: ['scanner'],
        summary: 'Crawl a URL and discover paths, forms, and app type',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScanRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Scan result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScanResult' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '502': { $ref: '#/components/responses/UpstreamError' },
        },
      },
    },
    '/test-configs': {
      post: {
        tags: ['configs'],
        summary: 'Create a reusable test configuration',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TestConfig' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TestConfig' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/test-runs': {
      get: {
        tags: ['runs'],
        summary: 'List recent test runs',
        responses: {
          '200': {
            description: 'Array of runs',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/TestRun' } },
              },
            },
          },
        },
      },
      post: {
        tags: ['runs'],
        summary: 'Create a new test run (without starting it)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  config_id: { type: 'integer', minimum: 1 },
                  status: {
                    type: 'string',
                    enum: ['pending', 'running', 'completed', 'cancelled', 'interrupted'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TestRun' } },
            },
          },
        },
      },
    },
    '/test-runs/{id}': {
      get: {
        tags: ['runs'],
        summary: 'Fetch one test run',
        parameters: [{ $ref: '#/components/parameters/RunId' }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TestRun' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/test-runs/{id}/start': {
      post: {
        tags: ['runs'],
        summary: 'Start a previously-created test run',
        parameters: [{ $ref: '#/components/parameters/RunId' }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  config: {
                    type: 'object',
                    description: 'Override config (optional, otherwise uses linked config_id)',
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Run started',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    status: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/test-runs/{id}/stop': {
      post: {
        tags: ['runs'],
        summary: 'Abort a running test',
        parameters: [{ $ref: '#/components/parameters/RunId' }],
        responses: {
          '200': { description: 'Run stopped' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/test-runs/{id}/cleanup': {
      post: {
        tags: ['runs'],
        summary: 'Delete a test run + its config',
        parameters: [{ $ref: '#/components/parameters/RunId' }],
        responses: { '200': { description: 'Cleaned up' } },
      },
    },
    '/test-runs/{id}/analyze': {
      post: {
        tags: ['analysis'],
        summary: 'Trigger the AI pipeline (returns immediately, runs in background)',
        parameters: [{ $ref: '#/components/parameters/RunId' }],
        responses: {
          '200': {
            description: 'Analysis started; poll /analysis for status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    runId: { type: 'string' },
                    status: { type: 'string', example: 'running' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/test-runs/{id}/analysis': {
      get: {
        tags: ['analysis'],
        summary: 'Fetch the latest analysis result for a run',
        parameters: [{ $ref: '#/components/parameters/RunId' }],
        responses: {
          '200': {
            description: 'Analysis result',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AnalysisResult' } },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/test-runs/{id}/analysis.pdf': {
      get: {
        tags: ['analysis'],
        summary: 'Download the analysis report as a PDF',
        parameters: [{ $ref: '#/components/parameters/RunId' }],
        responses: {
          '200': {
            description: 'PDF report stream',
            content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
          },
          '404': { $ref: '#/components/responses/NotFound' },
          '409': {
            description: 'Analysis is not yet complete',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      RunId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Test run UUID',
      },
    },
    responses: {
      ValidationError: {
        description: 'Request failed validation',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string', example: 'Invalid request' },
                issues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      message: { type: 'string' },
                      code: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { error: { type: 'string' } } },
          },
        },
      },
      RateLimited: {
        description: 'Too many requests; retry later',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { error: { type: 'string' } } },
          },
        },
      },
      UpstreamError: {
        description: 'Upstream service failure (e.g., target URL unreachable)',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { error: { type: 'string' } } },
          },
        },
      },
    },
    schemas: {
      ActiveRun: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          startedAt: { type: 'integer', description: 'Unix epoch ms' },
          config: { type: 'object', properties: { url: { type: 'string' } } },
        },
      },
      ScanRequest: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
          maxPages: { type: 'integer', minimum: 1, maximum: 30, default: 20 },
        },
      },
      ScanResult: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          appType: {
            type: 'object',
            properties: {
              detectedType: { type: 'string', enum: ['ecommerce', 'saas', 'blog', 'web'] },
            },
          },
          discoveredPaths: { type: 'array', items: { type: 'string' } },
          forms: { type: 'object', additionalProperties: true },
        },
      },
      TestConfig: {
        type: 'object',
        required: ['url'],
        properties: {
          id: { type: 'integer' },
          url: { type: 'string', format: 'uri' },
          user_count: { type: 'integer', minimum: 1, maximum: 1000 },
          duration_sec: { type: 'integer', minimum: 5, maximum: 3600 },
          ramp_up_sec: { type: 'integer', minimum: 0, maximum: 600 },
          app_type: { type: 'string', maxLength: 50, nullable: true },
          test_mode: { type: 'string', enum: ['http', 'browser', 'both'] },
          shadow_mode: { type: 'boolean' },
          respect_rate_limits: { type: 'boolean' },
          auto_stop_error_threshold: { type: 'integer', minimum: 0, maximum: 100 },
          discovered_paths: { type: 'array', items: { type: 'string' }, maxItems: 500 },
        },
      },
      TestRun: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          config_id: { type: 'integer', nullable: true },
          status: { type: 'string' },
          total_requests: { type: 'integer', nullable: true },
          error_rate: { type: 'number', nullable: true },
          avg_response_ms: { type: 'number', nullable: true },
          p50_ms: { type: 'integer', nullable: true },
          p95_ms: { type: 'integer', nullable: true },
          p99_ms: { type: 'integer', nullable: true },
          passed: { type: 'boolean', nullable: true },
          user_count: { type: 'integer', nullable: true },
          started_at: { type: 'string', format: 'date-time', nullable: true },
          ended_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      AnalysisResult: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'running', 'complete', 'error'] },
          error: { type: 'string', nullable: true },
          report: { type: 'object', additionalProperties: true },
          bugs: { type: 'array', items: { type: 'object', additionalProperties: true } },
          rcaReports: { type: 'array', items: { type: 'object', additionalProperties: true } },
          bottlenecks: { type: 'array', items: { type: 'object', additionalProperties: true } },
          prediction: { type: 'object', additionalProperties: true, nullable: true },
          cost: {
            type: 'object',
            properties: { estimatedUsd: { type: 'number' } },
          },
          analyzedAt: { type: 'integer', nullable: true },
        },
      },
    },
  },
} as const;
