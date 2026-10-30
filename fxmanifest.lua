name 'ai-properties'
author 'ai-core'
version '0.1.0'
license 'GPL-3.0-only'
description 'Houses and apartments: buy, enter a private interior, stash, keys, sell'
repository 'https://github.com/TGIANN/ai-properties'
fx_version 'cerulean'
game 'gta5'
node_version '22'

client_script 'dist/client.js'
server_script 'dist/server.js'


dependencies {
	'/onesync',
	'ai-core',
}

files {
	'locales/*.json',
	'data/properties.json',
	'data/interiors.json',
}
