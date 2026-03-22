# Claude 大神 Telegram Bot

一个接入 Claude AI 的 Telegram 私人助理。带四层记忆系统、自动学习、网络搜索、图片识别。越用越聪明，重启不丢失记忆。

Built by [@0xKingsKuan](https://x.com/0xKingsKuan)

-----

## 功能

- 智能对话 - 全 Claude AI 驱动，回答任何问题
- 自动学习记忆 - 每次对话后自动更新记忆档案
- 四层记忆架构 - soul、projects、tasks、notes + 向量记忆 + 对话摘要
- 永久记忆 - Supabase 存储，redeploy 不丢失
- 网络搜索 - 接入 Tavily，搜索最新资讯
- 图片识别 - 发图片直接分析
- 长内容输出 - 不会中途停止
- 多语言 - 你说什么语言它就回什么语言
- 24/7 云端运行

-----

## 需要准备

|服务                   |用途            |费用         |
|---------------------|--------------|-----------|
|Telegram @BotFather  |Bot Token     |免费         |
|console.anthropic.com|Claude API Key|需充值        |
|github.com           |存代码           |免费         |
|railway.app          |云端部署          |免费         |
|supabase.com         |数据库存记忆        |免费         |
|tavily.com           |网络搜索          |免费（每月1000次）|
|voyageai.com         |向量记忆          |免费         |

-----

## 部署步骤

### 第一步 - Telegram Bot Token

1. 打开 Telegram，搜索 @BotFather
1. 发送 /newbot
1. 取名字和用户名（用户名必须以 bot 结尾）
1. 复制保存 Token

### 第二步 - Anthropic API Key

1. 打开 console.anthropic.com
1. API Keys -> Create Key
1. 复制保存

### 第三步 - Supabase 数据库

1. supabase.com 注册，新建项目
1. SQL Editor -> New query -> 粘贴以下全部内容 -> Run：

```sql
create extension if not exists vector;

create table if not exists conversations (
  id serial primary key,
  user_id bigint not null,
  role text not null,
  content text not null,
  created_at timestamp default now()
);

create table if not exists user_docs (
  id serial primary key,
  user_id bigint not null,
  doc_type text not null,
  content text not null,
  updated_at timestamp default now(),
  unique(user_id, doc_type)
);

create table if not exists conversation_summaries (
  id serial primary key,
  user_id bigint not null,
  summary text not null,
  message_count int default 0,
  created_at timestamp default now()
);

create table if not exists memories (
  id serial primary key,
  user_id bigint not null,
  content text not null,
  memory_type text default 'general',
  embedding vector(1024),
  created_at timestamp default now()
);
```

1. Settings -> API -> 复制以下两个值：
- Project URL → 填入 SUPABASE_URL
- service_role key（不是 anon key）→ 填入 SUPABASE_KEY

### 第四步 - Tavily API Key

1. tavily.com 注册（免费）
1. 复制 API Key

### 第五步 - Voyage API Key

1. voyageai.com 注册（免费）
1. 复制 API Key

### 第六步 - 部署到 Railway

1. railway.app 用 GitHub 账号登录
1. New Project -> Deploy from GitHub repo
1. 选这个 repo

### 第七步 - 填入环境变量

Railway -> 你的项目 -> Variables：

|变量名              |说明                       |必填  |
|-----------------|-------------------------|----|
|BOT_TOKEN        |Telegram Bot Token       |必填  |
|ANTHROPIC_API_KEY|Anthropic API Key        |必填  |
|WEBHOOK_URL      |先留空，第八步填                 |必填  |
|SUPABASE_URL     |Supabase Project URL     |强烈建议|
|SUPABASE_KEY     |Supabase service_role key|强烈建议|
|TAVILY_API_KEY   |Tavily API Key           |可选  |
|VOYAGE_API_KEY   |Voyage API Key           |可选  |

重要：SUPABASE_KEY 必须用 service_role key，不能用 anon public key。

### 第八步 - 设置 Webhook

1. Railway -> Settings -> Networking -> Generate Domain
1. 复制生成的网址（https://xxx.railway.app）
1. 填入 WEBHOOK_URL（结尾不要加 /）
1. Railway 自动重新部署

### 第九步 - 测试

搜索你的 Bot -> 发 /start -> 开始对话！

建议第一件事，告诉 Bot 你是谁：

```
/setsoul 你的名字和背景
/setprojects 你的项目列表
/settasks 当前最重要的任务
```

-----

## 命令列表

查看记忆：

- /memory - 完整记忆总览
- /soul - 查看 soul.md
- /projects - 查看项目
- /tasks - 查看任务
- /notes - 查看笔记
- /summaries - 查看对话摘要

手动更新（Bot 会自动学习，通常不需要手动）：

- /setsoul [内容] - 更新 soul.md
- /setprojects [内容] - 更新项目
- /settasks [内容] - 更新任务
- /note [内容] - 添加笔记
- /clearnotes - 清空笔记
- /summarize - 立即压缩摘要

管理：

- /forget - 清除对话历史（保留记忆档案）
- /reset - 清除所有内容
- /help - 查看所有命令

-----

## 记忆系统说明

Bot 有四层记忆，全部自动运作：

- 第一层：soul.md + projects.md（永久身份，不变）
- 第二层：tasks.md + notes.md（动态知识，自动更新）
- 第三层：向量记忆（语义搜索历史信息）
- 第四层：对话摘要（每 20 条自动压缩）

每次对话后 Bot 会自动分析内容，提取重要信息写入对应档案，完全不需要手动操作。越用越聪明，越用越了解你。

-----

## 文件结构

```
telegram-claude-bot/
├── bot.cjs          主程序
├── package.json     依赖配置
├── railway.json     Railway 部署配置
├── .gitignore       忽略敏感文件
└── README.md        说明文档
```

-----

## 常见问题

Bot 没反应 - 检查 BOT_TOKEN、ANTHROPIC_API_KEY、WEBHOOK_URL 三个必填变量

Something went wrong - 检查 ANTHROPIC_API_KEY 是否正确，账号是否有余额

记忆消失 - 确认用的是 service_role key 而不是 anon key

记忆显示 Not set yet - 同上，换成 service_role key

搜索没用 - 确认 TAVILY_API_KEY 正确，Tavily 账号有余额

部署失败 - 确认 repo 里没有多余的 index.js

-----

## 想改 Bot 性格？

打开 bot.cjs，找到 SYSTEM_PROMPT 修改即可。

-----

## License

MIT - 随意使用、修改、分享。

如果这个项目对你有帮助，欢迎 Star 和 Fork！
