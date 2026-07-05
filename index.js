import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  TRAVEL_PLACES,
  MOOD_MISSIONS,
  MOOD_TOPICS,
  FAMILY_MISSIONS,
  haversine,
  seededPick,
  todaySeed
} from './data.js';

const NOMINATIM_UA = 'ArmooniaFamilyMCP/1.0 (contact: sukachoi@gmail.com)';

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=kr`;
  const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

function createServer() {
  const server = new McpServer({ name: 'armoonia-family', version: '1.0.0' });

  server.registerTool(
    'recommend_travel',
    {
      title: '여행지 추천',
      description: 'Happy Family Operation(행복한 가정만들기 작전)의 여행지 추천 도구입니다. 입력한 지역(도시/구/군) 기준으로 아이와 함께 가기 좋은 국내 여행지를 가까운 순으로 추천합니다. 연령대를 지정하면 해당 연령에 맞는 곳만 추천합니다.',
      inputSchema: {
        region: z.string().describe('기준이 되는 지역명 (예: 서울, 춘천, 부산 강서구)'),
        ageGroup: z.enum(['0~2세', '3~5세', '6~8세', '9세 이상']).optional().describe('아이 연령대 (선택)'),
        count: z.number().int().min(1).max(10).optional().describe('추천 개수 (기본 3개)')
      },
      annotations: {
        title: '여행지 추천',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ region, ageGroup, count }) => {
      const loc = await geocode(region);
      let list = ageGroup ? TRAVEL_PLACES.filter(p => p.age === ageGroup) : [...TRAVEL_PLACES];

      if (loc) {
        list = list.map(p => ({ ...p, dist: haversine(loc.lat, loc.lng, p.lat, p.lng) }));
        list.sort((a, b) => a.dist - b.dist);
      }

      const top = list.slice(0, count || 3);
      if (!top.length) {
        return { content: [{ type: 'text', text: `"${region}" 기준으로 추천할 여행지를 찾지 못했습니다.` }] };
      }

      const header = loc
        ? `"${region}" 기준 가까운 순 추천 여행지 ${top.length}곳:`
        : `"${region}"의 위치를 찾지 못해 거리순 정렬 없이 추천합니다:`;

      const lines = top.map((p, i) => {
        const distText = p.dist != null ? ` (약 ${Math.round(p.dist)}km)` : '';
        return `${i + 1}. ${p.icon} ${p.title}${distText} — ${p.loc}\n   ${p.desc}\n   💡 ${p.tip}`;
      });

      return { content: [{ type: 'text', text: [header, ...lines].join('\n\n') }] };
    }
  );

  server.registerTool(
    'couple_communication',
    {
      title: '부부 소통 도우미',
      description: 'Happy Family Operation(행복한 가정만들기 작전)의 부부 소통 도우미 도구입니다. 오늘 부부 사이의 상황(보통/다퉜어요/육아에 지쳤어요/기념일)을 알려주면 그에 맞는 감사 미션과 대화 주제를 하나씩 추천합니다. 하루 동안은 같은 상황이면 같은 내용이 유지됩니다.',
      inputSchema: {
        mood: z.enum(['보통', '다퉜어요', '육아에 지쳤어요', '기념일·기쁜날']).optional().describe('오늘 부부 사이 상황 (선택, 기본값 보통)')
      },
      annotations: {
        title: '부부 소통 도우미',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ mood }) => {
      const key = mood && MOOD_MISSIONS[mood] ? mood : '보통';
      const seed = todaySeed() + key.length;
      const mission = seededPick(MOOD_MISSIONS[key], seed);
      const topic = seededPick(MOOD_TOPICS[key], seed + 1);
      const text = [
        `💬 오늘의 부부 소통 추천 (${key})`,
        `🙏 감사 미션: ${mission}`,
        `🗣️ 대화 주제: ${topic}`
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'family_mission',
    {
      title: '가족 미션 추천',
      description: 'Happy Family Operation(행복한 가정만들기 작전)의 가족 미션 추천 도구입니다. 자녀 연령대(유아/초등)를 알려주면 그에 맞는, 오늘 온 가족이 함께 해볼 만한 미션을 하나 추천합니다.',
      inputSchema: {
        ageGroup: z.enum(['유아', '초등']).optional().describe('자녀 연령대 (선택, 미지정 시 전체 미션 중 추천)')
      },
      annotations: {
        title: '가족 미션 추천',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ ageGroup }) => {
      const pool = ageGroup
        ? FAMILY_MISSIONS.filter(m => m.age === ageGroup || m.age === '공통')
        : FAMILY_MISSIONS;
      const seed = todaySeed() + (ageGroup ? ageGroup.length : 0);
      const mission = seededPick(pool, seed + 2);
      const text = `🎯 오늘의 가족 미션: ${mission.title}\n(${mission.tag})`;
      return { content: [{ type: 'text', text }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
});

async function handleNoBody(req, res) {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
}

// MCP Streamable HTTP 표준: GET(서버→클라이언트 알림 스트림), DELETE(세션 종료)도 지원해야 함
app.get('/mcp', handleNoBody);
app.delete('/mcp', handleNoBody);

app.get('/health', (req, res) => res.json({ ok: true, name: 'armoonia-family-mcp' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`armoonia-family MCP server listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
