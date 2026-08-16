import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { metaRequest } from './meta.js';
import { registerExtraTools } from './extra-tools.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function accessToken(ctx: any): string {
  const token = ctx?.authInfo?.extra?.metaAccessToken;
  if (!token) throw new Error('Meta account is not connected. Complete the OAuth authorization flow first.');
  return String(token);
}

export function createMetaAdsServer(ctx: any) {
  const server = new McpServer({
    name: 'thedailyflare-meta-ads',
    version: '1.1.0',
    title: 'The Daily Flare Meta Ads MCP',
    description: 'Manage Meta/Facebook advertising accounts, campaigns, ad sets, ads, audiences and insights.'
  });

  server.registerTool('test_connection', { description: 'Test the Meta Graph API connection and return the authenticated user.' }, async () => text(await metaRequest(accessToken(ctx), 'me?fields=id,name')));

  server.registerTool('get_ad_accounts', { description: 'List advertising accounts available to the authenticated Meta user.' }, async () => text(await metaRequest(accessToken(ctx), 'me/adaccounts?fields=id,name,account_status,currency,timezone_name,amount_spent&limit=100')));

  server.registerTool('get_campaigns', { description: 'List campaigns for a Meta ad account.', inputSchema: z.object({ ad_account_id: z.string(), limit: z.number().int().min(1).max(500).optional() }) }, async ({ ad_account_id, limit = 50 }) => text(await metaRequest(accessToken(ctx), `${ad_account_id}/campaigns?fields=id,name,objective,status,daily_budget,lifetime_budget,special_ad_categories&limit=${limit}`)));

  server.registerTool('create_campaign', { description: 'Create a Meta advertising campaign. New campaigns default to PAUSED.', inputSchema: z.object({ ad_account_id: z.string(), name: z.string().min(1), objective: z.string().min(1), status: z.string().optional(), special_ad_categories: z.array(z.string()).optional() }) }, async (p) => {
    const body = new URLSearchParams({ name: p.name, objective: p.objective, status: p.status || 'PAUSED', special_ad_categories: JSON.stringify(p.special_ad_categories || []) });
    return text(await metaRequest(accessToken(ctx), `${p.ad_account_id}/campaigns`, { method: 'POST', body }));
  });

  server.registerTool('update_campaign', { description: 'Update a Meta advertising campaign.', inputSchema: z.object({ campaign_id: z.string(), name: z.string().optional(), status: z.string().optional(), daily_budget: z.string().optional(), lifetime_budget: z.string().optional() }) }, async (p) => {
    const body = new URLSearchParams(); for (const [k, v] of Object.entries(p)) if (v !== undefined) body.set(k, v);
    return text(await metaRequest(accessToken(ctx), p.campaign_id, { method: 'POST', body }));
  });

  server.registerTool('delete_campaign', { description: 'Delete a Meta advertising campaign.', inputSchema: z.object({ campaign_id: z.string() }) }, async ({ campaign_id }) => text(await metaRequest(accessToken(ctx), campaign_id, { method: 'DELETE' })));

  server.registerTool('get_adsets', { description: 'List ad sets belonging to a Meta campaign or ad account.', inputSchema: z.object({ parent_id: z.string(), limit: z.number().int().min(1).max(500).optional() }) }, async ({ parent_id, limit = 50 }) => text(await metaRequest(accessToken(ctx), `${parent_id}/adsets?fields=id,name,campaign_id,status,daily_budget,lifetime_budget,billing_event,optimization_goal,targeting&limit=${limit}`)));

  server.registerTool('create_adset', { description: 'Create a Meta advertising ad set. New ad sets default to PAUSED.', inputSchema: z.object({ ad_account_id: z.string(), campaign_id: z.string(), name: z.string().min(1), daily_budget: z.string().min(1), billing_event: z.string().min(1), optimization_goal: z.string().min(1), targeting: z.string().min(2), status: z.string().optional() }) }, async (p) => {
    const body = new URLSearchParams({ campaign_id: p.campaign_id, name: p.name, daily_budget: p.daily_budget, billing_event: p.billing_event, optimization_goal: p.optimization_goal, targeting: p.targeting, status: p.status || 'PAUSED' });
    return text(await metaRequest(accessToken(ctx), `${p.ad_account_id}/adsets`, { method: 'POST', body }));
  });

  server.registerTool('update_adset', { description: 'Update a Meta advertising ad set.', inputSchema: z.object({ adset_id: z.string(), name: z.string().optional(), status: z.string().optional(), daily_budget: z.string().optional(), targeting: z.string().optional() }) }, async (p) => {
    const body = new URLSearchParams(); for (const [k, v] of Object.entries(p)) if (v !== undefined) body.set(k, v);
    return text(await metaRequest(accessToken(ctx), p.adset_id, { method: 'POST', body }));
  });

  server.registerTool('delete_adset', { description: 'Delete a Meta advertising ad set.', inputSchema: z.object({ adset_id: z.string() }) }, async ({ adset_id }) => text(await metaRequest(accessToken(ctx), adset_id, { method: 'DELETE' })));

  server.registerTool('get_ads', { description: 'List ads belonging to an ad set, campaign, or ad account.', inputSchema: z.object({ parent_id: z.string(), limit: z.number().int().min(1).max(500).optional() }) }, async ({ parent_id, limit = 50 }) => text(await metaRequest(accessToken(ctx), `${parent_id}/ads?fields=id,name,status,effective_status,adset_id,campaign_id,creative{id,name}&limit=${limit}`)));

  server.registerTool('create_ad', { description: 'Create a Meta advertisement using an existing creative. New ads default to PAUSED.', inputSchema: z.object({ ad_account_id: z.string(), adset_id: z.string(), name: z.string().min(1), creative_id: z.string(), status: z.string().optional() }) }, async (p) => {
    const body = new URLSearchParams({ adset_id: p.adset_id, name: p.name, creative: JSON.stringify({ creative_id: p.creative_id }), status: p.status || 'PAUSED' });
    return text(await metaRequest(accessToken(ctx), `${p.ad_account_id}/ads`, { method: 'POST', body }));
  });

  server.registerTool('update_ad', { description: 'Update a Meta advertisement.', inputSchema: z.object({ ad_id: z.string(), name: z.string().optional(), status: z.string().optional() }) }, async (p) => {
    const body = new URLSearchParams(); for (const [k, v] of Object.entries(p)) if (v !== undefined) body.set(k, v);
    return text(await metaRequest(accessToken(ctx), p.ad_id, { method: 'POST', body }));
  });

  server.registerTool('delete_ad', { description: 'Delete a Meta advertisement.', inputSchema: z.object({ ad_id: z.string() }) }, async ({ ad_id }) => text(await metaRequest(accessToken(ctx), ad_id, { method: 'DELETE' })));

  server.registerTool('get_insights', { description: 'Get Meta advertising performance insights for any supported object.', inputSchema: z.object({ object_id: z.string(), fields: z.string().optional(), date_preset: z.string().optional(), level: z.string().optional() }) }, async ({ object_id, fields = 'impressions,reach,clicks,spend,ctr,cpc,cpm,actions', date_preset = 'last_7d', level }) => {
    const q = new URLSearchParams({ fields, date_preset }); if (level) q.set('level', level);
    return text(await metaRequest(accessToken(ctx), `${object_id}/insights?${q.toString()}`));
  });

  server.registerTool('get_audiences', { description: 'List custom audiences available to a Meta ad account.', inputSchema: z.object({ ad_account_id: z.string(), limit: z.number().int().min(1).max(500).optional() }) }, async ({ ad_account_id, limit = 50 }) => text(await metaRequest(accessToken(ctx), `${ad_account_id}/customaudiences?fields=id,name,description,subtype,approximate_count_lower_bound,approximate_count_upper_bound&limit=${limit}`)));

  server.registerTool('create_custom_audience', { description: 'Create a custom audience in a Meta ad account.', inputSchema: z.object({ ad_account_id: z.string(), name: z.string().min(1), description: z.string().optional(), subtype: z.string().optional() }) }, async (p) => {
    const body = new URLSearchParams({ name: p.name, description: p.description || '', subtype: p.subtype || 'CUSTOM' });
    return text(await metaRequest(accessToken(ctx), `${p.ad_account_id}/customaudiences`, { method: 'POST', body }));
  });

  server.registerTool('get_pages', { description: 'List Facebook Pages accessible to the authenticated Meta user. Page access tokens are never returned.' }, async () => text(await metaRequest(accessToken(ctx), 'me/accounts?fields=id,name,tasks&limit=100')));

  server.registerTool('get_page_posts', { description: 'Get recent posts from a Facebook Page.', inputSchema: z.object({ page_id: z.string(), limit: z.number().int().min(1).max(100).optional() }) }, async ({ page_id, limit = 25 }) => text(await metaRequest(accessToken(ctx), `${page_id}/posts?fields=id,message,created_time,permalink_url,status_type&limit=${limit}`)));

  server.registerTool('get_page_insights', { description: 'Get Facebook Page performance insights.', inputSchema: z.object({ page_id: z.string(), metric: z.string().optional(), period: z.string().optional() }) }, async ({ page_id, metric = 'page_impressions,page_engaged_users,page_post_engagements', period = 'day' }) => text(await metaRequest(accessToken(ctx), `${page_id}/insights?metric=${encodeURIComponent(metric)}&period=${encodeURIComponent(period)}`)));

  registerExtraTools(server, () => accessToken(ctx));
  return server;
}
