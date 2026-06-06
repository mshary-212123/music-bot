import discord
from discord.ext import commands, tasks
from discord.ui import View, Button
import yt_dlp
import asyncio

# ══════════════════════════════════════════
#           إعدادات البوت
# ══════════════════════════════════════════
TOKEN = "MTUxMjg0ODc3NDc2NTIxNTgwNQ.GzXQiK.hpGdiDFOc15_7VOgblxrrF6S-WUZ57lPZXLPCQ"
GUILD_ID = 1494487267975106581
VOICE_CHANNEL_ID = 1507776010593107989

# ══════════════════════════════════════════
#           إعدادات YT-DLP
# ══════════════════════════════════════════
ytdl_format_options = {
    'format': 'bestaudio/best',
    'restrictfilenames': True,
    'noplaylist': True,
    'nocheckcertificate': True,
    'quiet': True,
    'default_search': 'scsearch',
    'source_address': '0.0.0.0',
}

ffmpeg_options = {
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
    'options': '-vn -threads 1 -loglevel quiet',
}

ytdl = yt_dlp.YoutubeDL(ytdl_format_options)

# ══════════════════════════════════════════
#           متغيرات عامة
# ══════════════════════════════════════════
queue = []
current_song = None
volume_level = 100

intents = discord.Intents.all()
bot = commands.Bot(command_prefix='!', intents=intents, help_command=None)


# ══════════════════════════════════════════
#           دالة الاتصال بالروم
# ══════════════════════════════════════════
async def ensure_voice():
    try:
        guild = bot.get_guild(GUILD_ID)
        if not guild: return None
        channel = bot.get_channel(VOICE_CHANNEL_ID)
        if not channel: return None
        vc = guild.voice_client
        if vc is None or not vc.is_connected():
            vc = await channel.connect(self_deaf=True, reconnect=True, timeout=10)
        elif vc.channel.id != VOICE_CHANNEL_ID:
            await vc.move_to(channel)
        return vc
    except Exception:
        return None


# ══════════════════════════════════════════
#           تشغيل الأغنية التالية
# ══════════════════════════════════════════
async def play_next(ctx):
    global current_song, volume_level
    if not queue:
        current_song = None
        return
    query = queue.pop(0)
    try:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(
            None,
            lambda: ytdl.extract_info(
                f"scsearch:{query}" if not query.startswith('http') else query,
                download=False
            )
        )
        if 'entries' in data:
            data = data['entries'][0]

        current_song = data
        vc = await ensure_voice()
        if not vc: return

        source = discord.FFmpegPCMAudio(data['url'], **ffmpeg_options)
        source = discord.PCMVolumeTransformer(source, volume=volume_level / 100.0)
        vc.play(source, after=lambda e: asyncio.run_coroutine_threadsafe(play_next(ctx), bot.loop))

        duration_sec = data.get('duration', 0)
        duration_str = f"{duration_sec // 60}:{duration_sec % 60:02d}" if duration_sec else "غير معروف"
        artist = data.get('uploader') or data.get('creator') or data.get('artist') or "غير معروف"

        embed = discord.Embed(
            title=data.get('title', 'غير معروف'),
            url=data.get('webpage_url', ''),
            color=0xff5500
        )
        embed.set_author(
            name="SoundCloud",
            icon_url="https://a-v2.sndcdn.com/assets/images/sc-icons/ios-a62da610.png"
        )
        embed.add_field(name="🎤 الفنان", value=artist, inline=False)
        embed.add_field(name="⏱ المدة", value=duration_str, inline=True)
        embed.add_field(name="🔊 الصوت", value=f"{volume_level}%", inline=True)
        if data.get('thumbnail'):
            embed.set_image(url=data['thumbnail'])
        embed.set_footer(text="v <(20-500)>رقم  •  skip  •  stop  •  queue")

        await ctx.send(embed=embed)
    except Exception as e:
        print(f"[Error] {e}")
        await play_next(ctx)


# ══════════════════════════════════════════
#           Heartbeat - رجوع سريع <1 ثانية
# ══════════════════════════════════════════
@tasks.loop(seconds=1)
async def heartbeat():
    if not bot.is_ready(): return
    try:
        guild = bot.get_guild(GUILD_ID)
        if not guild: return
        vc = guild.voice_client
        if vc is None or not vc.is_connected() or vc.channel.id != VOICE_CHANNEL_ID:
            await ensure_voice()
    except Exception:
        pass


# ══════════════════════════════════════════
#           لوحة التحكم الرئيسية
# ══════════════════════════════════════════
class ControlPanel(View):
    def __init__(self, ctx):
        super().__init__(timeout=120)
        self.ctx = ctx

    @discord.ui.button(label="🔄 تغيير الروم", style=discord.ButtonStyle.primary)
    async def change_room(self, interaction: discord.Interaction, button: Button):
        await interaction.response.send_message("📨 أرسل ID الروم الصوتي أو رابطه:", ephemeral=True)
        def check(m): return m.author == interaction.user and m.channel == interaction.channel
        try:
            msg = await bot.wait_for('message', check=check, timeout=30)
            content = msg.content.strip()
            if 'discord.com/channels/' in content:
                new_channel_id = int(content.split('/')[-1])
            else:
                new_channel_id = int(content)
            global VOICE_CHANNEL_ID
            VOICE_CHANNEL_ID = new_channel_id
            guild = bot.get_guild(GUILD_ID)
            channel = bot.get_channel(new_channel_id)
            if guild and channel:
                vc = guild.voice_client
                if vc: await vc.move_to(channel)
                else: await channel.connect(self_deaf=True, reconnect=True)
                await msg.reply(f"✅ تم نقل البوت إلى **{channel.name}**!")
            else:
                await msg.reply("❌ لم يتم العثور على الروم.")
        except asyncio.TimeoutError: pass
        except Exception as e:
            await interaction.followup.send(f"❌ خطأ: {e}", ephemeral=True)

    @discord.ui.button(label="🔒 تثبيت الروم الحالي", style=discord.ButtonStyle.success)
    async def lock_room(self, interaction: discord.Interaction, button: Button):
        channel = bot.get_channel(VOICE_CHANNEL_ID)
        name = channel.name if channel else str(VOICE_CHANNEL_ID)
        await interaction.response.send_message(
            f"📌 البوت مثبت على: **{name}**\nسيرجع فوراً إذا تم طرده أو نقله.",
            ephemeral=True
        )

    @discord.ui.button(label="📋 قائمة التشغيل", style=discord.ButtonStyle.secondary)
    async def show_queue(self, interaction: discord.Interaction, button: Button):
        if not queue and not current_song:
            await interaction.response.send_message("📭 القائمة فارغة.", ephemeral=True)
            return
        lines = []
        if current_song: lines.append(f"▶️ **يعزف الآن:** {current_song.get('title', '?')}")
        for i, s in enumerate(queue, 1): lines.append(f"`{i}.` {s}")
        embed = discord.Embed(title="🎵 قائمة التشغيل", description="\n".join(lines), color=0xff5500)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @discord.ui.button(label="⏹ إيقاف الكل", style=discord.ButtonStyle.danger)
    async def stop_all(self, interaction: discord.Interaction, button: Button):
        guild = bot.get_guild(GUILD_ID)
        if guild and guild.voice_client: guild.voice_client.stop()
        queue.clear()
        await interaction.response.send_message("⏹️ تم الإيقاف وتفريغ القائمة.", ephemeral=True)


# ══════════════════════════════════════════
#           لوحة تحكم البوتات
# ══════════════════════════════════════════
class AllBotsPanel(View):
    def __init__(self, ctx):
        super().__init__(timeout=60)
        self.ctx = ctx

    @discord.ui.button(label="✅ دخول البوت للروم", style=discord.ButtonStyle.success)
    async def join_room(self, interaction: discord.Interaction, button: Button):
        vc = await ensure_voice()
        channel = bot.get_channel(VOICE_CHANNEL_ID)
        name = channel.name if channel else str(VOICE_CHANNEL_ID)
        msg = f"✅ دخل الروم: **{name}**" if vc else "❌ فشل الدخول."
        await interaction.response.send_message(msg, ephemeral=True)

    @discord.ui.button(label="🚪 إخراج البوت من الروم", style=discord.ButtonStyle.danger)
    async def leave_room(self, interaction: discord.Interaction, button: Button):
        guild = bot.get_guild(GUILD_ID)
        if guild and guild.voice_client:
            await guild.voice_client.disconnect()
            await interaction.response.send_message("🚪 تم الإخراج.", ephemeral=True)
        else:
            await interaction.response.send_message("❌ البوت ليس في روم.", ephemeral=True)


# ══════════════════════════════════════════
#           أحداث البوت
# ══════════════════════════════════════════
@bot.event
async def on_ready():
    print(f"✅ Bot Online: {bot.user}")
    await ensure_voice()
    if not heartbeat.is_running():
        heartbeat.start()


@bot.event
async def on_message(message):
    global volume_level
    if message.author == bot.user: return

    # لوحة التحكم عند المنشن
    if bot.user in message.mentions:
        content_clean = message.content.replace(f'<@{bot.user.id}>', '').replace(f'<@!{bot.user.id}>', '').strip().lower()
        if content_clean in ['all bot', 'all bots', 'كل البوتات']:
            embed = discord.Embed(title="🤖 لوحة تحكم البوتات", description="اختر الإجراء:", color=0xff5500)
            await message.channel.send(embed=embed, view=AllBotsPanel(message))
        else:
            embed = discord.Embed(
                title="🎛️ لوحة التحكم",
                description=(
                    "**الأوامر:**\n"
                    "`p` أو `ش` + اسم/رابط → تشغيل\n"
                    "`skip` → تخطي\n"
                    "`stop` أو `وقف` → إيقاف\n"
                    "`queue` → القائمة\n"
                    "`v <20-500>` → الصوت\n\n"
                    "**أو استخدم الأزرار:**"
                ),
                color=0xff5500
            )
            await message.channel.send(embed=embed, view=ControlPanel(message))
        return

    if not isinstance(message.author, discord.Member): return
    if not message.author.voice or message.author.voice.channel.id != VOICE_CHANNEL_ID: return

    content = message.content.strip()
    content_lower = content.lower()
    ctx = await bot.get_context(message)

    # تشغيل: p أو ش
    if content_lower.startswith('p ') or content.startswith('ش '):
        query = content[2:].strip()
        if query:
            queue.append(query)
            vc = await ensure_voice()
            if vc and not vc.is_playing(): await play_next(ctx)
            else: await message.add_reaction('✅')

    # الصوت: v رقم
    elif content_lower.startswith('v '):
        try:
            val = int(content[2:].strip())
            if 20 <= val <= 500:
                volume_level = val
                guild = bot.get_guild(GUILD_ID)
                if guild and guild.voice_client and guild.voice_client.source:
                    guild.voice_client.source.volume = val / 100.0
                await message.reply(f"🔊 الصوت: **{val}%**")
            else:
                await message.reply("❌ الصوت يجب بين 20 و 500")
        except ValueError:
            await message.reply("❌ مثال: `v 150`")

    # تخطي: skip
    elif content_lower == 'skip':
        guild = bot.get_guild(GUILD_ID)
        if guild and guild.voice_client and guild.voice_client.is_playing():
            guild.voice_client.stop()
            await message.reply("⏭️ تم التخطي.")
        else:
            await message.reply("❌ لا توجد أغنية تعزف.")

    # إيقاف: stop أو وقف
    elif content_lower in ['stop', 'وقف']:
        guild = bot.get_guild(GUILD_ID)
        if guild and guild.voice_client: guild.voice_client.stop()
        queue.clear()
        await message.reply("⏹️ تم الإيقاف.")

    # القائمة: queue
    elif content_lower == 'queue':
        if not queue and not current_song:
            await message.reply("📭 القائمة فارغة.")
        else:
            lines = []
            if current_song: lines.append(f"▶️ **يعزف الآن:** {current_song.get('title', '?')}")
            for i, s in enumerate(queue, 1): lines.append(f"`{i}.` {s}")
            embed = discord.Embed(title="🎵 قائمة التشغيل", description="\n".join(lines), color=0xff5500)
            await message.channel.send(embed=embed)

    await bot.process_commands(message)


# ══════════════════════════════════════════
#           تشغيل البوت
# ══════════════════════════════════════════
bot.run(TOKEN)
