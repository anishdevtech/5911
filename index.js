const { Client, GatewayIntentBits, Routes, PermissionsBitField } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { REST } = require('@discordjs/rest');
const { SlashCommandBuilder } = require('@discordjs/builders');
const ytdl = require('ytdl-core');
const { google } = require('googleapis');
const Enmap = require('enmap');
require('dotenv').config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const artistSettings = new Enmap({ name: 'artistSettings' });

const commands = [
    new SlashCommandBuilder().setName('play').setDescription('Play songs from the set artist or a specified artist.')
        .addStringOption(option =>
            option.setName('artist')
                .setDescription('The name of the artist')
                .setRequired(false)),
    new SlashCommandBuilder().setName('setup').setDescription('Set the artist for the guild.')
        .addStringOption(option =>
            option.setName('artist')
                .setDescription('The name of the artist')
                .setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('Skip the current song.'),
    new SlashCommandBuilder().setName('pause').setDescription('Pause the current song.'),
    new SlashCommandBuilder().setName('resume').setDescription('Resume the current song.'),
    new SlashCommandBuilder().setName('queue').setDescription('View the song queue.'),
    new SlashCommandBuilder().setName('clearqueue').setDescription('Clear the song queue.'),
    new SlashCommandBuilder().setName('volume').setDescription('Set the volume.')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Volume level from 1 to 100')
                .setRequired(true)),
    new SlashCommandBuilder().setName('nowplaying').setDescription('Display the currently playing song.'),
    new SlashCommandBuilder().setName('loop').setDescription('Loop the current song or queue.')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Loop mode: off, song, or queue')
                .setRequired(true)),
    new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue.'),
    new SlashCommandBuilder().setName('seek').setDescription('Seek to a specific timestamp in the song.')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Timestamp to seek to (mm:ss)')
                .setRequired(true)),
    new SlashCommandBuilder().setName('lyrics').setDescription('Fetch and display lyrics for the current song.'),
    new SlashCommandBuilder().setName('savequeue').setDescription('Save the current queue.'),
    new SlashCommandBuilder().setName('loadqueue').setDescription('Load a saved queue.'),
    new SlashCommandBuilder().setName('setdj').setDescription('Set a DJ role.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to set as DJ')
                .setRequired(true)),
    new SlashCommandBuilder().setName('setprefix').setDescription('Set a custom prefix for commands.')
        .addStringOption(option =>
            option.setName('prefix')
                .setDescription('The custom prefix')
                .setRequired(true)),
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

let currentGuildSettings = {};

async function fetchSongsByArtist(artist) {
    const youtube = google.youtube({
        version: 'v3',
        auth: YOUTUBE_API_KEY
    });

    const response = await youtube.search.list({
        part: 'snippet',
        q: artist,
        maxResults: 50,
        type: 'video',
    });

    return response.data.items.map(item => `https://www.youtube.com/watch?v=${item.id.videoId}`);
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        await interaction.reply('You do not have permission to use this command.');
        return;
    }

    const guildId = interaction.guild.id;

    if (commandName === 'play') {
        if (interaction.member.voice.channel) {
            const artist = interaction.options.getString('artist') || artistSettings.get(guildId);
            if (!artist) {
                await interaction.reply('Artist not set. Please use /setup to set an artist.');
                return;
            }

            const songQueue = await fetchSongsByArtist(artist);

            const connection = joinVoiceChannel({
                channelId: interaction.member.voice.channel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer();
            connection.subscribe(player);

            playNextSong(player, songQueue);

            player.on(AudioPlayerStatus.Idle, () => playNextSong(player, songQueue));
            player.on('error', error => console.error(`Error: ${error.message}`));

            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                await new Promise(resolve => setTimeout(resolve, 5000));
                if (connection.state.status === VoiceConnectionStatus.Disconnected) {
                    connection.destroy();
                }
            });

            await interaction.reply(`Playing songs by ${artist}`);
        } else {
            await interaction.reply('You need to join a voice channel first!');
        }
    } else if (commandName === 'setup') {
        const artist = interaction.options.getString('artist');
        artistSettings.set(guildId, artist);
        await interaction.reply(`Artist set to ${artist}`);
    } else if (commandName === 'skip') {
        if (currentGuildSettings[guildId].player) {
            currentGuildSettings[guildId].player.stop();
            await interaction.reply('Skipped the current song.');
        } else {
            await interaction.reply('No song is currently playing.');
        }
    } else if (commandName === 'pause') {
        if (currentGuildSettings[guildId].player) {
            currentGuildSettings[guildId].player.pause();
            await interaction.reply('Paused the current song.');
        } else {
            await interaction.reply('No song is currently playing.');
        }
    } else if (commandName === 'resume') {
        if (currentGuildSettings[guildId].player) {
            currentGuildSettings[guildId].player.unpause();
            await interaction.reply('Resumed the current song.');
        } else {
            await interaction.reply('No song is currently playing.');
        }
    } else if (commandName === 'queue') {
        const queue = currentGuildSettings[guildId].queue || [];
        if (queue.length > 0) {
            await interaction.reply(`Current queue:\n${queue.join('\n')}`);
        } else {
            await interaction.reply('The queue is empty.');
        }
    } else if (commandName === 'clearqueue') {
        currentGuildSettings[guildId].queue = [];
        await interaction.reply('Cleared the song queue.');
    } else if (commandName === 'volume') {
        const level = interaction.options.getInteger('level');
        currentGuildSettings[guildId].volume = level / 100;
        await interaction.reply(`Volume set to ${level}%`);
    } else if (commandName === 'nowplaying') {
        if (currentGuildSettings[guildId].nowPlaying) {
            await interaction.reply(`Now playing: ${currentGuildSettings[guildId].nowPlaying}`);
        } else {
            await interaction.reply('No song is currently playing.');
        }
    } else if (commandName === 'loop') {
        const mode = interaction.options.getString('mode');
        currentGuildSettings[guildId].loop = mode;
        await interaction.reply(`Loop mode set to ${mode}`);
    } else if (commandName === 'shuffle') {
        currentGuildSettings[guildId].queue = currentGuildSettings[guildId].queue.sort(() => Math.random() - 0.5);
        await interaction.reply('Shuffled the queue.');
    } else if (commandName === 'seek') {
        const time = interaction.options.getString('time');
        const [minutes, seconds] = time.split(':').map(Number);
        const seekTime = minutes * 60 + seconds;
        if (currentGuildSettings[guildId].player) {
            const stream = ytdl(currentGuildSettings[guildId].nowPlaying, { filter: 'audioonly' });
            const resource = createAudioResource(stream, { seek: seekTime });
            currentGuildSettings[guildId].player.play(resource);
            await interaction.reply(`Seeked to ${time}`);
        } else {
            await interaction.reply('No song is currently playing.');
        }
    } else if (commandName === 'lyrics') {
        // Add logic to fetch and display lyrics
    } else if (commandName === 'savequeue') {
        // Add logic to save the current queue
    } else if (commandName === 'loadqueue') {
        // Add logic to load a saved queue
    } else if (commandName === 'setdj') {
        const role = interaction.options.getRole('role');
        artistSettings.set(`${guildId}_dj`, role.id);
        await interaction.reply(`DJ role set to ${role.name}`);
    } else if (commandName === 'setprefix') {
        const prefix = interaction.options.getString('prefix');
        artistSettings.set(`${guildId}_prefix`, prefix);
        await interaction.reply(`Prefix set to ${prefix}`);
    }
});

function playNextSong(player, songQueue) {
    if (songQueue.length === 0) {
        console.log('Queue is empty.');
        return;
    }

    const stream = ytdl(songQueue.shift(), { filter: 'audioonly' });
    const resource = createAudioResource(stream);
    player.play(resource);
}

client.login(DISCORD_TOKEN);
