/**
 * GET /api/docs
 *
 * Returns an OpenAPI 3.0 specification describing the major REST endpoints of
 * the PDB Structure Tracker API. The spec is served as `application/json` so it
 * can be pasted directly into Swagger UI, Redoc, or Postman.
 *
 * The spec is generated from a plain JS object (no third-party OpenAPI builder
 * dependency) so it stays in lock-step with the actual route handlers. Update
 * the `buildSpec()` object when an endpoint changes.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const APP_VERSION = '1.0.0';

/** Reusable 500 error response shape. */
const internalError = {
  description: 'Internal server error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
};

/** Reusable Health response shape. */
const healthSchema = {
  type: 'object',
  required: ['status', 'timestamp', 'uptime', 'memory', 'db', 'version'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    timestamp: { type: 'string', format: 'date-time' },
    uptime: { type: 'number', description: 'Process uptime in seconds' },
    memory: {
      type: 'object',
      properties: {
        rss: { type: 'number' },
        heapUsed: { type: 'number' },
        heapTotal: { type: 'number' },
        external: { type: 'number' },
      },
    },
    db: { type: 'string', enum: ['connected', 'error'] },
    version: { type: 'string' },
  },
};

/** Build the full OpenAPI 3.0 document. Kept as a function so the route is a
 *  pure handler and the spec is regenerated on every request (cheap). */
function buildSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'PDB Structure Tracker API',
      version: APP_VERSION,
      description:
        'REST API for the PDB Structure Tracker — a tool that tracks weekly PDB structure releases, evaluates target coverage via UniProt/BLAST, and aggregates literature digests. Use `/api/health` for liveness probes and `/api/db-config` to manage the active SQLite database.',
    },
    servers: [
      { url: '/', description: 'Relative to the deployed origin' },
    ],
    tags: [
      { name: 'snapshots', description: 'Weekly PDB release snapshots' },
      { name: 'entries', description: 'PDB structure entries' },
      { name: 'evaluations', description: 'Target evaluations (UniProt + BLAST)' },
      { name: 'db-config', description: 'Active SQLite database configuration' },
      { name: 'health', description: 'Liveness / readiness probes' },
      { name: 'literature', description: 'Daily literature digests' },
      { name: 'pdb-weekly', description: 'Weekly PDB report generation' },
    ],
    paths: {
      '/api/snapshots': {
        get: {
          tags: ['snapshots'],
          summary: 'List weekly PDB release snapshots',
          description:
            'Returns aggregated weekly counts of released PDB structures, broken down by experimental method (Cryo-EM, X-ray, NMR, other).',
          parameters: [],
          responses: {
            '200': {
              description: 'Array of weekly snapshot summaries',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Snapshot' },
                  },
                },
              },
            },
            '500': internalError,
          },
        },
      },
      '/api/entries': {
        get: {
          tags: ['entries'],
          summary: 'List PDB structure entries',
          description:
            'Returns individual PDB structure entries, optionally filtered by query parameters.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Free-text search over PDB id / title / ligand.',
            },
            {
              name: 'weekId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Restrict to a specific weekly snapshot id (e.g. W202401).',
            },
          ],
          responses: {
            '200': {
              description: 'Array of PDB entries',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/PdbEntry' },
                  },
                },
              },
            },
            '500': internalError,
          },
        },
      },
      '/api/evaluations': {
        get: {
          tags: ['evaluations'],
          summary: 'List all target evaluations',
          description:
            'Returns evaluation batches, sub-targets, and individual evaluations with their associated PDB structures and BLAST results.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Search over UniProt id / protein name / gene names.',
            },
          ],
          responses: {
            '200': {
              description: 'Evaluations payload',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/EvaluationsResponse' },
                },
              },
            },
            '500': internalError,
          },
        },
      },
      '/api/evaluations/run': {
        post: {
          tags: ['evaluations'],
          summary: 'Run a target evaluation',
          description:
            'Triggers a full evaluation run for one or more UniProt targets: fetches PDB structures, runs BLAST, scores coverage, and persists the result.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['uniprotIds'],
                  properties: {
                    uniprotIds: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'List of UniProt accession ids to evaluate.',
                    },
                    options: {
                      type: 'object',
                      description: 'Optional run options (force refresh, blast thresholds…).',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Run accepted / completed',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      results: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Missing or invalid request body',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': internalError,
          },
        },
      },
      '/api/evaluations/{uniprotId}': {
        delete: {
          tags: ['evaluations'],
          summary: 'Delete a target evaluation',
          description:
            'Permanently deletes the evaluation row and its associated PDB / BLAST child rows for the given UniProt id.',
          parameters: [
            {
              name: 'uniprotId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'UniProt accession id of the evaluation to delete.',
            },
          ],
          responses: {
            '200': {
              description: 'Evaluation deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { ok: { type: 'boolean' }, uniprotId: { type: 'string' } },
                  },
                },
              },
            },
            '404': {
              description: 'Evaluation not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': internalError,
          },
        },
      },
      '/api/db-config': {
        get: {
          tags: ['db-config'],
          summary: 'Read active database configuration',
          description:
            'Returns the currently-resolved database path, schema status, table list, and sample row counts.',
          parameters: [],
          responses: {
            '200': {
              description: 'Current DB configuration',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DbConfig' },
                },
              },
            },
            '500': internalError,
          },
        },
        post: {
          tags: ['db-config'],
          summary: 'Switch / create the active database',
          description:
            'Persists a new `dbPath` to `.hermes/db-config.json`, optionally creates the file, optionally initializes the Prisma schema, and recreates the PrismaClient so all modules read the new DB immediately. Use `?action=init` to (re)initialize the schema on the currently-active DB.',
          parameters: [
            {
              name: 'action',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['init'] },
              description: 'When `init`, run `prisma db push` on the active DB instead of switching paths.',
            },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    dbPath: { type: 'string', description: 'New database file path (absolute or relative to project root).' },
                    create: { type: 'boolean', description: 'Create the file if it does not exist.' },
                    initSchema: { type: 'boolean', default: true, description: 'Run `prisma db push` after switching.' },
                    confirmed: { type: 'boolean', description: 'Mark the path as user-confirmed (setup wizard).' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Config updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DbConfig' },
                },
              },
            },
            '400': {
              description: 'Missing dbPath',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Database file does not exist',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': internalError,
          },
        },
      },
      '/api/health': {
        get: {
          tags: ['health'],
          summary: 'Liveness / readiness probe',
          description:
            'Returns process uptime, memory usage, DB connectivity, and app version. HTTP 200 when healthy, 503 when the DB probe fails.',
          parameters: [],
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': { schema: healthSchema },
              },
            },
            '503': {
              description: 'Service is degraded (DB unreachable)',
              content: {
                'application/json': { schema: healthSchema },
              },
            },
          },
        },
      },
      '/api/literature/daily/run': {
        post: {
          tags: ['literature'],
          summary: 'Run the daily literature digest',
          description:
            'Streams a server-sent events (SSE) log as the daily literature pipeline runs: fetches PubMed citations, matches journals to impact factors, and generates an LLM summary.',
          parameters: [],
          responses: {
            '200': {
              description: 'SSE stream of run progress events',
              content: {
                'text/event-stream': {
                  schema: { type: 'string', description: 'SSE event stream' },
                },
              },
            },
            '500': internalError,
          },
        },
      },
      '/api/pdb-weekly/run': {
        post: {
          tags: ['pdb-weekly'],
          summary: 'Run the weekly PDB report generator',
          description:
            'Streams an SSE log as the weekly PDB pipeline runs: fetches new structures from RCSB, classifies by method/ligand, and writes a weekly snapshot row.',
          parameters: [],
          responses: {
            '200': {
              description: 'SSE stream of run progress events',
              content: {
                'text/event-stream': {
                  schema: { type: 'string', description: 'SSE event stream' },
                },
              },
            },
            '500': internalError,
          },
        },
      },
    },
    components: {
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
          },
        },
        Snapshot: {
          type: 'object',
          properties: {
            weekId: { type: 'string' },
            weekStart: { type: 'string', format: 'date' },
            weekEnd: { type: 'string', format: 'date' },
            totalStructures: { type: 'integer' },
            cryoemCount: { type: 'integer' },
            xrayCount: { type: 'integer' },
            nmrCount: { type: 'integer' },
            otherCount: { type: 'integer' },
            createdAt: { type: 'string' },
          },
        },
        PdbEntry: {
          type: 'object',
          properties: {
            pdbId: { type: 'string' },
            title: { type: 'string' },
            method: { type: 'string' },
            resolution: { type: 'number', nullable: true },
            releaseDate: { type: 'string' },
            ligand: { type: 'string', nullable: true },
            organism: { type: 'string', nullable: true },
            authors: { type: 'string', nullable: true },
            weekId: { type: 'string', nullable: true },
          },
        },
        Evaluation: {
          type: 'object',
          properties: {
            uniprotId: { type: 'string' },
            entryName: { type: 'string', nullable: true },
            proteinName: { type: 'string' },
            geneNames: { type: 'string', nullable: true },
            organism: { type: 'string', nullable: true },
            sequenceLength: { type: 'integer', nullable: true },
            coverage: { type: 'number', nullable: true },
            scores: { type: 'string', nullable: true, description: 'JSON-encoded score breakdown' },
            report: { type: 'string', nullable: true },
            batchId: { type: 'string', nullable: true },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
        EvaluationsResponse: {
          type: 'object',
          properties: {
            batches: { type: 'array', items: { type: 'object' } },
            batchSubTargets: { type: 'object' },
            individualEvals: { type: 'array', items: { $ref: '#/components/schemas/Evaluation' } },
            allEvaluations: { type: 'array', items: { $ref: '#/components/schemas/Evaluation' } },
          },
        },
        DbConfig: {
          type: 'object',
          properties: {
            configuredDbPath: { type: 'string', nullable: true },
            confirmed: { type: 'boolean' },
            updatedAt: { type: 'string', nullable: true },
            activeUrl: { type: 'string' },
            activeFsPath: { type: 'string' },
            isTest: { type: 'boolean' },
            exists: { type: 'boolean' },
            hasSchema: { type: 'boolean' },
            tableCount: { type: 'integer' },
            tables: { type: 'array', items: { type: 'string' } },
            counts: { type: 'object' },
            defaultTestPath: { type: 'string' },
            testDbAbs: { type: 'string' },
            env: { type: 'string' },
            configFile: { type: 'string' },
          },
        },
      },
    },
  };
}

export async function GET() {
  const spec = buildSpec();
  return NextResponse.json(spec, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
