# 🤖 Claude 大神 Bot

**EN:** A personal AI assistant powered by Claude, running on Telegram. Bounty hunting automation, multi-file project generation, Web3 security tools, smart memory, and contract monitoring — all from your phone.

**中文:** 基于 Claude 的 Telegram 私人 AI 助理。赏金自动化猎手、多文件项目生成、Web3 安全工具、智能记忆系统和合约实时监控 —— 全部手机操作。

Built by [@0xKingsKuan](https://twitter.com/0xKingsKuan) · v12.0

-----

## 🚀 One-Click Deploy / 一键部署

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/hi0iqD?referralCode=ztkI8u&utm_medium=integration&utm_source=template&utm_campaign=generic)

**EN:** Click the button above → fill in environment variables → done in 5 minutes.

**中文:** 点上面按钮 → 填入环境变量 → 5 分钟完成部署。

-----

## ✨ What Makes It Special / 核心亮点

- 🎯 **Bounty Pipeline** — Automatically scans 6+ Web3 bounty platforms, scores opportunities with AI, and **learns from your accept/reject decisions** to get smarter over time.
- 🧠 **Sonnet Brainstorm** — For every bounty, Claude Sonnet proposes **3 differentiated winning ideas** with unique angles. Tap a button to pick.
- 🏗 **Multi-file Code Generation** — Splits projects into `index.js` + `lib/core.js` so ambitious ideas don’t get truncated. Auto-continues when hitting token limits, validates with `node --check` before pushing.
- 🛡 **Fail-Loud** — If generated code doesn’t parse, it’s NOT pushed to GitHub. No more polluted repos.
- 🔬 **Web3 Native** — Slither audits, contract decompilation, Alchemy webhook monitoring with smart filters.
- 💰 **Cost Transparency** — `/stats` shows real-time $ spend per model with hourly burn rate.

-----

## 📦 Manual Deploy / 手动部署

### Step 1 — Create Telegram Bot / 创建 Telegram Bot

- Open [@BotFather](https://t.me/BotFather) → send `/newbot` → follow prompts → copy your **BOT_TOKEN**
- 打开 [@BotFather](https://t.me/BotFather) → 发送 `/newbot` → 按提示走 → 复制 **BOT_TOKEN**

### Step 2 — Get Your Telegram User ID / 获取你的 Telegram User ID

- Open [@userinfobot](https://t.me/userinfobot) → it replies with your numeric ID
- This becomes `PIPELINE_OWNER_ID`
- 打开 [@userinfobot](https://t.me/userinfobot) → 它会回复你的数字 ID
- 这个 ID 就是 `PIPELINE_OWNER_ID`

### Step 3 — Get API Keys / 获取 API Keys

|Service / 服务      |Where / 获取地址                                                       |Required / 必须          |
|------------------|-------------------------------------------------------------------|-----------------------|
|Anthropic         |[console.anthropic.com](https://console.anthropic.com) → API Keys  |✅                      |
|Supabase          |[supabase.com](https://supabase.com) → New Project → Settings → API|✅                      |
|Telegram BOT_TOKEN|@BotFather                                                         |✅                      |
|Tavily            |[tavily.com](https://tavily.com)                                   |推荐 / Recommended       |
|Voyage AI         |[voyageai.com](https://voyageai.com)                               |推荐 / Recommended       |
|GitHub Token      |github.com → Settings → Developer Settings → PAT (repo scope)      |`/vibe`                |
|Gemini API Key    |[aistudio.google.com](https://aistudio.google.com)                 |`/imagine`             |
|Vercel Token      |vercel.com → Settings → Tokens                                     |Auto preview           |
|Railway API Token |railway.app → Account → Tokens                                     |`/deploy`              |
|Etherscan API Key |[etherscan.io/apis](https://etherscan.io/apis)                     |`/decompile` `/slither`|
|Alchemy Webhook   |alchemy.com → Notify → Create Webhook                              |`/watch`               |

### Step 4 — Supabase Setup / 设置 Supabase

**EN:** Create a new project → open **SQL Editor** → run the SQL below → all tables have RLS disabled (set per row in the SQL).

**中文:** 新建项目 → 打开 **SQL Editor** → 运行下方 SQL → SQL 里已经包含关闭 RLS 的指令。

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

-- Bounty preference learning (used by /preferences)
create table if not exists bounty_decisions (
  id bigserial primary key,
  ts bigint,
  decision text,
  platform text,
  type text,
  reward float,
  currency text,
  title text,
  score int
);
create index if not exists bounty_decisions_ts_idx on bounty_decisions(ts desc);

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
alter table bounty_decisions disable row level security;
```

### Step 5 — Deploy to Railway / 部署到 Railway

**EN:** Fork this repo → [railway.app](https://railway.app) → New Project → Deploy from GitHub → select your fork → add environment variables (see next section).

**中文:** Fork 本仓库 → [railway.app](https://railway.app) → New Project → Deploy from GitHub → 选你的 Fork → 添加环境变量（看下一节）。

### Step 6 — Set Webhook / 设置 Webhook

**EN:** After deployment, copy your Railway public URL (e.g. `https://your-app.up.railway.app`) and add it as `WEBHOOK_URL`. Redeploy.

**中文:** 部署完后，复制 Railway 生成的域名（例如 `https://your-app.up.railway.app`），加入环境变量 `WEBHOOK_URL`，重新部署。

```env
WEBHOOK_URL=https://your-app.up.railway.app
```

### Step 7 — Test / 测试

**EN:** Send `/help` to your bot. If you see the full command list, you’re live ✅

**中文:** 发 `/help` 给 bot，看到完整命令列表就成功了 ✅

-----

## ⚙️ Environment Variables / 环境变量

```env
# ✅ Required / 必须
BOT_TOKEN=                     # @BotFather 给的 token
ANTHROPIC_API_KEY=             # console.anthropic.com
WEBHOOK_URL=                   # Railway 域名（不带末尾斜杠）
SUPABASE_URL=                  # Supabase project URL
SUPABASE_KEY=                  # service_role key（不是 anon key）

# 💡 Recommended / 推荐
TAVILY_API_KEY=                # Agent 网页搜索
VOYAGE_API_KEY=                # 向量记忆搜索
GITHUB_TOKEN=                  # /vibe 建项目推 GitHub
GEMINI_API_KEY=                # /imagine 图片生成

# 🤖 Pipeline (自动赏金)
PIPELINE_ENABLED=true
PIPELINE_OWNER_ID=             # 你的 Telegram user ID（@userinfobot 获取）
PIPELINE_HOURS=1,2,3,4,5,6     # 运行时段（UTC 24h 制）
PIPELINE_DELAY_MINS=3          # 赏金之间间隔（分钟）

# 🔧 Optional / 可选
RAILWAY_API_TOKEN=             # /deploy 命令
VERCEL_TOKEN=                  # /vibe 完成后自动部署预览
ETHERSCAN_API_KEY=             # /decompile 合约分析
SLITHER_API_URL=               # Slither 微服务 URL（自部署）
SLITHER_API_KEY=               # Slither 微服务密钥
ALCHEMY_SIGNING_KEY=           # /watch webhook 签名验证

# 🧠 Model overrides / 模型配置
AI_MODEL=claude-opus-4-5                  # 主对话 + 代码生成
AI_FAST_MODEL=claude-haiku-4-5-20251001   # 分类 / 提取等轻量任务
AI_IDEA_MODEL=claude-sonnet-4-5           # /vibe 头脑风暴 3 方案
```

-----

## 🎯 Complete Command Reference / 完整命令表

### 🏆 Bounty Hunting / 赏金猎手 (核心)

|Command               |What it does / 功能                                                                                                                                                      |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|`/vibe`               |Send an idea OR a bounty URL → Sonnet brainstorms 3 differentiated ideas → tap to pick → multi-file project auto-generated → pushed to GitHub → optional Vercel preview|
|`/redo`               |Regenerate the last `/vibe` project with same params (don’t like the result? try again)                                                                                |
|`/vibestop`           |Exit vibe mode                                                                                                                                                         |
|`/pipeline`           |Manually trigger bounty scan + auto-execute high-score ones                                                                                                            |
|`/pipeline dry`       |**Safe preview** — shows discovered bounties + scores, but does NOT execute (no GitHub spam)                                                                           |
|`/pipelinestatus`     |Check pipeline status, owner ID, seen bounties count                                                                                                                   |
|`/preferences`        |View bounty profile bot has learned (your accept rate, liked types/platforms)                                                                                          |
|`/preferences clear`  |Reset learned preferences                                                                                                                                              |
|`/briefing`           |Generate today’s Crypto market briefing                                                                                                                                |
|`/deploy <github_url>`|Deploy a GitHub repo to Railway                                                                                                                                        |

### 🔬 Web3 Tools / Web3 工具

|Command                 |What it does / 功能                                 |
|------------------------|--------------------------------------------------|
|`/decompile 0x...`      |Decompile contract + AI architecture analysis     |
|`/slither 0x...`        |Slither static security audit + Chinese PDF report|
|`/watch <addr>`         |Real-time contract monitoring via Alchemy webhooks|
|`/watch <addr> --min=N` |Only alert on transactions ≥ N ETH (smart filter) |
|`/watch <addr> --remove`|Stop monitoring                                   |
|`/graph <topic>`        |Generate knowledge graph SVG                      |
|`/price BTC/ETH/SOL`    |Real-time crypto prices                           |

### 💻 Code Tools / 代码工具

Just send any code file to the bot and it auto-analyzes + offers to fix.

|Command       |What it does           |
|--------------|-----------------------|
|`/explain`    |Explain code logic     |
|`/review`     |Code review with score |
|`/test`       |Generate test cases    |
|`/save <name>`|Save a code version    |
|`/load <name>`|Load a saved version   |
|`/versions`   |List all saved versions|

### 💬 Conversation Tools / 对话工具

|Command                   |What it does                |
|--------------------------|----------------------------|
|`/translate <lang> <text>`|Translation                 |
|`/improve <text>`         |Polish writing              |
|`/brainstorm <topic>`     |Brainstorm analysis         |
|`/summarize`              |Compress chat history       |
|`/imagine <description>`  |AI image generation (Gemini)|
|`/weekly`                 |This week’s activity summary|

### 🧠 Memory System / 记忆系统 (4 层)

|Command                   |What it does          |
|--------------------------|----------------------|
|`/memory`                 |Full memory overview  |
|`/soul` `/setsoul`        |Personal profile      |
|`/projects` `/setprojects`|Project profile       |
|`/tasks` `/settasks`      |Task profile          |
|`/notes` `/note <text>`   |Quick notes           |
|`/clearnotes`             |Clear notes           |
|`/summaries`              |View history summaries|

### ⚙️ Utilities / 实用工具

|Command                  |What it does                                            |
|-------------------------|--------------------------------------------------------|
|`/stats`                 |Token usage + real $ cost (per-model breakdown + $/hour)|
|`/errors`                |Recent error log (last 15)                              |
|`/remind <time> <text>`  |Set reminder (30m / 2h / 1d)                            |
|`/template save/use/list`|Manage prompt templates                                 |
|`/export`                |Export chat history                                     |
|`/cancel`                |Cancel all running tasks                                |
|`/forget`                |Clear conversation history                              |
|`/reset`                 |Reset everything                                        |
|`/help`                  |Full command list                                       |

### 📎 Auto-Handled / 自动支持

- Send a **PDF, ZIP, DOCX, XLSX, image, or code file** → auto-parsed and analyzed
- Send a **URL** → auto-fetched and summarized
- Send a **bounty link** in `/vibe` → auto-classified (content / dev / hackathon / audit)

-----

## 🏗 How It Works / 架构亮点

### Multi-File Code Generation / 多文件代码生成

Hackathon projects often need 1500+ lines. A single 8192-token response can’t fit that, so the bot:

1. **Splits architecture**: `index.js` (entry, ~30 lines) + `lib/core.js` (business logic, can be huge)
1. **Continuation**: Detects `stop_reason === "max_tokens"` and feeds back to keep going (up to 4 rounds, ~32K tokens)
1. **Validates**: Runs `node --check` on every generated file before pushing to GitHub
1. **Fail-loud**: If validation fails twice, nothing gets pushed — you get a clear error message

### Bounty Preference Learning / 赏金偏好学习

The bot tracks every bounty you accept or reject. After 3+ decisions, it builds a profile:

- Liked platforms (Gitcoin, Devpost, etc.)
- Liked types (dev / content / video / audit)
- Average reward you accept
- Accept rate

This profile is injected into `scoreBounty` as a ±2 bias — quality of opportunity still matters most, but bot learns your taste.

### Smart Memory / 智能记忆

Four-layer memory system:

- **Soul**: who you are
- **Projects**: what you’re building
- **Tasks**: what you’re doing
- **Notes**: dated quick captures
- Plus **vector memory** via Voyage AI + pgvector for semantic recall

`autoLearnMemory` extracts new facts after every 5 conversations. `autoDream` consolidates memory once an hour. `autoCompact` summarizes history when it grows too large.

### Cost Optimization / 成本优化

- **Prompt caching** on all heavy paths (file/photo handlers wrapped in `buildCachedSystem`)
- **Per-model cost tracking** with $/hour projection in `/stats`
- **Trivial messages skipped** in autoLearnMemory (no API call for “thanks” / “ok”)
- **Single-call extraction** instead of separate worth-check + extract

-----

## 🛠 Tech Stack / 技术栈

|Layer               |Tech                        |
|--------------------|----------------------------|
|Bot Framework       |Telegraf (Node.js, CommonJS)|
|AI Main / 主模型       |Claude Opus                 |
|AI Brainstorm / 头脑风暴|Claude Sonnet               |
|AI Fast / 快速模型      |Claude Haiku                |
|Image Gen / 图片生成    |Gemini 2.5 Flash            |
|Database / 数据库      |Supabase + pgvector         |
|Web Search / 搜索     |Tavily                      |
|Vector Memory / 向量记忆|Voyage AI                   |
|Web3 Audit / 安全审计   |Slither (microservice)      |
|Web3 Monitor / 合约监控 |Alchemy Webhooks            |
|Screenshots / 截图    |Puppeteer                   |
|Deployment / 部署     |Railway                     |

-----

## 🐛 Troubleshooting / 故障排除

### `/vibe` 一直失败 / Always fails

- 检查 `GITHUB_TOKEN` 是否有 `repo` 权限
- 用 `/errors` 看最近的错误
- 项目太复杂可以试试更聚焦的需求

### Pipeline 不自动跑 / Pipeline doesn’t auto-run

- 确保 `PIPELINE_ENABLED=true` 和 `PIPELINE_OWNER_ID` 都设了
- 检查 `PIPELINE_HOURS` 当前是否在允许时段（UTC 时间）
- `/pipelinestatus` 看状态

### `/watch` 没收到通知 / No alerts

- 在 [alchemy.com](https://alchemy.com) Notify 设置 webhook URL 为 `https://你的域名/webhook/alchemy`
- 设置 `ALCHEMY_SIGNING_KEY` 验证签名

### Memory not working / 记忆失效

- `VOYAGE_API_KEY` 没设的话向量搜索关闭（其他记忆仍工作）
- 检查 Supabase `vector` 扩展是否启用

### Cost too high / 费用过高

- `/stats` 查看哪个模型在烧钱
- 考虑设 `AI_MODEL=claude-sonnet-4-5` 把主模型换 Sonnet

-----

## 📜 License

MIT

-----

*Claude 大神 Bot v12.0 — Built by [@0xKingsKuan](https://twitter.com/0xKingsKuan)*

*🚀 Star the repo if it helps you ship faster!*
