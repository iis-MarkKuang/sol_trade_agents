import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AgentMcpServerService } from './agent-mcp-server.service';

/**
 * Mounts the MCP Streamable HTTP endpoint at /mcp.
 *
 * The MCP SDK's transport writes directly to the raw express response, so we
 * use @Res() without passthrough and let the transport own the response. We
 * also read the already-parsed body from req.body (express json middleware).
 */
@Controller('mcp')
export class AgentMcpController {
  private readonly logger = new Logger(AgentMcpController.name);

  constructor(private readonly mcp: AgentMcpServerService) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response) {
    const method = req.method.toUpperCase();

    if (method === 'POST') {
      try {
        await this.mcp.handlePost(req, res, req.body);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`MCP POST failed: ${msg}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
      return;
    }

    // Stateless server: GET/DELETE are not supported (no sessions).
    res
      .writeHead(405, { 'Content-Type': 'application/json' })
      .end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed. Use POST.' },
          id: null,
        }),
      );
  }
}
