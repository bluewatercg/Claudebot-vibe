# 🤖 Claude 大神 Bot

**EN:** A personal AI assistant powered by Claude, running on Telegram. Bounty automation, Web3 security tools, 4-layer memory, and smart contract monitoring.

**中文:** 基于 Claude 的 Telegram 私人 AI 助理。赏金自动化、Web3 安全工具、四层记忆系统和智能合约监控。

Built by [@0xKingsKuan](https://twitter.com/0xKingsKuan)

-----

## 🚀 One-Click Deploy / 一键部署

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/hi0iqD?referralCode=ztkI8u&utm_medium=integration&utm_source=template&utm_campaign=generic)

-----

## 📦 Manual Deploy / 手动部署

### Step 1 — Create Telegram Bot / 创建 Telegram Bot

- Open [@BotFather](https://t.me/BotFather) → send `/newbot` → copy your **BOT_TOKEN**
- 打开 [@BotFather](https://t.me/BotFather) → 发送 `/newbot` → 复制 **BOT_TOKEN**

### Step 2 — Get API Keys / 获取 API Keys

|服务 / Service      |获取地址 / Where                                                       |必须 / Required  |
|------------------|-------------------------------------------------------------------|---------------|
|Anthropic         |[console.anthropic.com](https://console.anthropic.com) → API Keys  |✅              |
|Supabase          |[supabase.com](https://supabase.com) → New Project → Settings → API|✅              |
|Telegram BOT_TOKEN|@BotFather                                                         |✅              |
|Tavily            |[tavily.com](https://tavily.com)                                   |推荐             |
|Voyage AI         |[voyageai.com](https://voyageai.com)                               |推荐             |
|GitHub Token      |github.com → Settings → Developer Settings → PAT                   |/vibe 功能       |
|Gemini API Key    |[aistudio.google.com](https://aistudio.google.com)                 |/imagine 图片生成  |
|Vercel Token      |vercel.com → Settings → Tokens                                     |自动预览           |
|Railway API Token |railway.app → Account → Tokens                                     |/deploy 命令     |
|Etherscan API Key |[etherscan.io/apis](https://etherscan.io/apis)                     |/decompile 合约分析|

### Step 3 — Supabase Setup / 设置 Supabase

**EN:** Create a new project → go to **SQL Editor** → run the SQL below → disable RLS on all tables.

**中文:** 新建项目 → 打开 **SQL Editor** → 运行下方 SQL → 所有表关闭 RLS。

```sql
create extension if not exists vector;

create table if not exists conversations (
  id bigserial primary key,
  user_id bigint not null,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

create table if not exists user_docs (
  user_id bigint not null,
  doc_type text not null,
  content text,
  updated_at timestamptz default now(),
  primary key (user_id, doc_type)
);

create table if not exists conversation_summaries (
  user_id bigint primary key,
  summary text,
  updated_at timestamptz default now()
);

create table if not exists memories (
  id bigserial primary key,
  user_id bigint not null,
  content text not null,
  memory_type text default 'general',
  embedding vector(1024),
  created_at timestamptz default now()
);

create table if not exists vibe_sessions (
  user_id bigint primary key,
  session jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists agent_tasks (
  id text primary key,
  user_id bigint not null,
  type text not null,
  status text default 'running',
  current_step int default 0,
  total_steps int default 5,
  bounty jsonb,
  context jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function search_memories(
  query_embedding vector(1024),
  match_user_id bigint,
  match_count int default 5
) returns table (content text, similarity float)
language sql stable as $$
  select content, 1 - (embedding <=> query_embedding) as similarity
  from memories
  where user_id = match_user_id and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

alter table conversations disable row level security;
alter table user_docs disable row level security;
alter table conversation_summaries disable row level security;
alter table memories disable row level security;
alter table vibe_sessions disable row level security;
alter table agent_tasks disable row level security;
```

### Step 4 — Deploy to Railway / 部署到 Railway

**EN:** Fork this repo → [railway.app](https://railway.app) → New Project → Deploy from GitHub → select your fork → add environment variables.

**中文:** Fork 本仓库 → [railway.app](https://railway.app) → New Project → Deploy from GitHub → 选择你的 Fork → 添加环境变量。

### Step 5 — Set Webhook / 设置 Webhook

**EN:** After deployment, add your Railway public URL as an environment variable:

**中文:** 部署完成后，把 Railway 生成的域名加入环境变量：

```
WEBHOOK_URL=https://your-app.up.railway.app
```

### Step 6 — Test / 测试

**EN:** Send `/start` to your bot. If it replies, you’re live ✅

**中文:** 给 bot 发 `/start`，收到回复即部署成功 ✅

-----

## ⚙️ Environment Variables / 环境变量

```env
# ✅ 必须 / Required
BOT_TOKEN=                    # From @BotFather
ANTHROPIC_API_KEY=            # From console.anthropic.com
WEBHOOK_URL=                  # Railway public URL（不带末尾斜杠）
SUPABASE_URL=                 # Supabase project URL
SUPABASE_KEY=                 # service_role key（不是 anon key）

# 💡 推荐 / Recommended
TAVILY_API_KEY=               # Agent 网页搜索
VOYAGE_API_KEY=               # 向量记忆搜索
GITHUB_TOKEN=                 # /vibe 建项目推 GitHub
GEMINI_API_KEY=               # /imagine 图片生成

# 🔧 可选 / Optional
RAILWAY_API_TOKEN=            # /deploy 命令
VERCEL_TOKEN=                 # /vibe 完成后自动部署预览
ETHERSCAN_API_KEY=            # /decompile 合约分析
SLITHER_API_URL=              # Slither 微服务 URL
SLITHER_API_KEY=              # Slither 微服务密钥
ALCHEMY_SIGNING_KEY=          # Webhook 签名验证

# ⏰ Pipeline 设置
PIPELINE_ENABLED=true
PIPELINE_OWNER_ID=            # 你的 Telegram user ID（从 @userinfobot 获取）
PIPELINE_HOURS=1,2,3,4,5,6   # 运行时间（UTC）
PIPELINE_DELAY_MINS=3         # 赏金之间间隔（分钟）
```

-----


### 🛠 Vibe Coding

- `/vibe` — 描述项目 → AI 建项目 → 推 GitHub → Vercel 预览截图 / Describe → AI builds → GitHub → preview

### 🧠 Memory / 记忆 (4 层)

- Soul / Projects / Tasks / Notes
- Voyage AI + pgvector 向量相似度搜索 / Vector semantic search

### ⚙️ Other Commands / 其他命令

|命令                                   |功能                                 |
|-------------------------------------|-----------------------------------|
|`/price`                             |实时加密价格 / Real-time crypto prices   |
|`/imagine`                           |AI 图片生成 / Image generation (Gemini)|
|`/fix` `/explain` `/review` `/test`  |代码工具 / Code tools                  |
|`/remind`                            |定时提醒 / Timed reminders             |
|`/template`                          |Prompt 模板 / Saved prompts          |
|`/translate` `/improve` `/brainstorm`|写作工具 / Writing tools               |
|`/cancel`                            |中止所有任务 / Cancel all running tasks  |
|`/stats`                             |Token 用量统计 / Usage stats           |

-----

## 🛠 Tech Stack / 技术栈

|                    |                            |
|--------------------|----------------------------|
|Bot Framework       |Telegraf (Node.js, CommonJS)|
|AI Main / 主模型       |Claude Opus                 |
|AI Fast / 快速模型      |Claude Haiku                |
|Image Gen / 图片生成    |Gemini 2.5 Flash            |
|Database / 数据库      |Supabase + pgvector         |
|Web Search / 搜索     |Tavily                      |
|Vector Memory / 向量记忆|Voyage AI                   |
|Screenshots / 截图    |Puppeteer                   |
|Deployment / 部署     |Railway                     |

-----

*Claude 大神 v11.0 — Built by [@0xKingsKuan](https://twitter.com/0xKingsKuan)*
