import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { metaRequest } from './meta.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerExtraTools(server: McpServer, getToken: () => string) {
  server.registerTool('get_ad_account', {
    description: 'Get detailed information for one Meta advertising account.',
    inputSchema: z.object({ ad_account_id: z.string() })
  }, async ({ ad_account_id }) => text(await metaRequest(getToken(), `${ad_account_id}?fields=id,name,account_status,disable_reason,currency,timezone_name,timezone_offset_hours_utc,amount_spent,balance,spend_cap,business`)));

  server.registerTool('get_ad_creatives', {
    description: 'List ad creatives available to a Meta advertising account.',
    inputSchema: z.object({ ad_account_id: z.string(), limit: z.number().int().min(1).max(500).optional() })
  }, async ({ ad_account_id, limit = 50 }) => text(await metaRequest(getToken(), `${ad_account_id}/adcreatives?fields=id,name,status,object_story_id,object_type,thumbnail_url,asset_feed_spec&limit=${limit}`)));

  server.registerTool('get_campaign_insights', {
    description: 'Get campaign-level performance for a Meta ad account.',
    inputSchema: z.object({ ad_account_id: z.string(), date_preset: z.string().optional(), fields: z.string().optional() })
  }, async ({ ad_account_id, date_preset = 'last_7d', fields = 'campaign_id,campaign_name,impressions,reach,clicks,spend,ctr,cpc,cpm,actions' }) => {
    const q = new URLSearchParams({ level: 'campaign', date_preset, fields });
    return text(await metaRequest(getToken(), `${ad_account_id}/insights?${q.toString()}`));
  });

  server.registerTool('get_adset_insights', {
    description: 'Get ad-set-level performance for a Meta ad account.',
    inputSchema: z.object({ ad_account_id: z.string(), date_preset: z.string().optional(), fields: z.string().optional() })
  }, async ({ ad_account_id, date_preset = 'last_7d', fields = 'adset_id,adset_name,campaign_id,impressions,reach,clicks,spend,ctr,cpc,cpm,actions' }) => {
    const q = new URLSearchParams({ level: 'adset', date_preset, fields });
    return text(await metaRequest(getToken(), `${ad_account_id}/insights?${q.toString()}`));
  });

  server.registerTool('get_ad_insights', {
    description: 'Get ad-level performance for a Meta ad account.',
    inputSchema: z.object({ ad_account_id: z.string(), date_preset: z.string().optional(), fields: z.string().optional() })
  }, async ({ ad_account_id, date_preset = 'last_7d', fields = 'ad_id,ad_name,adset_id,campaign_id,impressions,reach,clicks,spend,ctr,cpc,cpm,actions' }) => {
    const q = new URLSearchParams({ level: 'ad', date_preset, fields });
    return text(await metaRequest(getToken(), `${ad_account_id}/insights?${q.toString()}`));
  });
}
