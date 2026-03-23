const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/socket.io')) {
        return;
    }

    const urlPath = req.url.split('?')[0];
    let filePath;
    
    if (urlPath === '/' || urlPath === '/index.html') {
        filePath = path.join(__dirname, 'chat-client.html');
    } else if (urlPath === '/gomoku.html') {
        filePath = path.join(__dirname, 'gomoku.html');
    } else if (urlPath === '/fishing.html') {
        filePath = path.join(__dirname, 'fishing.html');
    } else if (urlPath === '/memory.html') {
        filePath = path.join(__dirname, 'memory.html');
    } else if (urlPath === '/monopoly.html') {
        filePath = path.join(__dirname, 'monopoly.html');
    } else {
        res.writeHead(404);
        res.end('Not found');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end('Error loading file');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
});

const { Server } = require('socket.io');
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 50e6,
    pingTimeout: 60000,
    pingInterval: 25000
});

const users = new Map();
const userProfiles = new Map();
const teamInvites = new Map();
const gameRooms = new Map();
const fishingRooms = new Map();
const memoryRooms = new Map();
const monopolyRooms = new Map();
let gameRoomCounter = 0;
let fishingRoomCounter = 0;
let memoryRoomCounter = 0;
let monopolyRoomCounter = 0;

let roomPassword = null;
let serverIP = null;
const authenticatedUsers = new Set();
let roomName = '局域网聊天室';

const PIECES = ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜', '🚲', '🏍️', '✈️'];
const PIECE_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63', '#00bcd4', '#8bc34a', '#ff5722', '#795548', '#607d8b', '#ff9800', '#03a9f4', '#673ab7'];

const CHANCE_CARDS = [
    { text: '捡到钱包，获得$1000', money: 1000 },
    { text: '拾金不昧，奖励$200', money: 200 },
    { text: '违章停车，罚款$400', money: -400 },
    { text: '彩票中奖，获得$1500', money: 1500 },
    { text: '医疗费用，支出$300', money: -300 },
    { text: '生日礼物，获得$500', money: 500 },
    { text: '房屋维修，支出$600', money: -600 },
    { text: '投资收益，获得$800', money: 800 },
    { text: '交通罚款，支出$250', money: -250 },
    { text: '年终奖金，获得$2000', money: 2000 },
    { text: '免费搭车，前进3步', steps: 3 },
    { text: '遗落背包，后退2步', steps: -2 },
    { text: '顺风车，前进5步', steps: 5 },
    { text: '迷路了，后退4步', steps: -4 },
    { text: '旅游中奖，前进2步', steps: 2 },
    { text: '错过班车，后退3步', steps: -3 },
    { text: '保险理赔，获得$700', money: 700 },
    { text: '手机丢失，支出$350', money: -350 },
    { text: '股票分红，获得$1200', money: 1200 },
    { text: '超速罚单，支出$500', money: -500 }
];

function startMonopolyGame(roomId, room) {
    io.to(roomId).emit('allPiecesSelected', {
        countdown: 3
    });

    let countdown = 3;
    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            io.to(roomId).emit('gameCountdown', { countdown });
        } else {
            clearInterval(countdownInterval);
            
            room.started = true;
            room.currentTurn = 0;

            io.to(roomId).emit('monopolyGameStarted', {
                board: room.board,
                players: room.players.map(p => ({ 
                    name: p.name, 
                    money: p.money, 
                    position: p.position, 
                    piece: p.piece,
                    isHost: p.isHost,
                    isRobot: p.isRobot
                })),
                currentTurn: 0
            });

            const playerNames = room.players.filter(p => !p.isRobot).map(p => p.name).join('、');
            const robotCount = room.players.filter(p => p.isRobot).length;
            let startText = `👥 玩家: ${playerNames || '无'}`;
            if (robotCount > 0) {
                startText += `\n🤖 机器人: ${robotCount}个`;
            }
            
            io.emit('gameStart', {
                text: startText,
                gameType: 'monopoly',
                players: room.players.map(p => p.name),
                time: new Date().toLocaleTimeString()
            });

            console.log('大富翁游戏开始:', roomId);

            const firstPlayer = room.players[0];
            console.log(`第一个玩家: ${firstPlayer?.name}, isRobot: ${firstPlayer?.isRobot}`);
            if (firstPlayer && firstPlayer.isRobot) {
                console.log('第一个玩家是机器人，触发机器人回合');
                setTimeout(() => handleRobotTurn(roomId), 1500);
            }
        }
    }, 1000);
}

function handleRobotTurn(roomId) {
    const room = monopolyRooms.get(roomId);
    if (!room || !room.started) {
        console.log('handleRobotTurn: 房间不存在或游戏未开始');
        return;
    }

    const player = room.players[room.currentTurn];
    console.log(`handleRobotTurn: 当前玩家 ${player?.name}, isRobot: ${player?.isRobot}, currentTurn: ${room.currentTurn}`);
    if (!player || !player.isRobot || player.bankrupt) {
        console.log('handleRobotTurn: 玩家不是机器人或已破产');
        return;
    }

    setTimeout(() => {
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;
        
        const player = room.players[room.currentTurn];
        if (!player || !player.isRobot || player.bankrupt) return;

        if (player.skipTurn) {
            player.skipTurn = false;
            
            io.to(roomId).emit('turnSkipped', {
                playerName: player.name
            });
            
            setTimeout(() => {
                const room = monopolyRooms.get(roomId);
                if (!room) return;
                
                let nextTurn = room.currentTurn;
                let attempts = 0;
                
                do {
                    nextTurn = (nextTurn + 1) % room.players.length;
                    attempts++;
                } while (room.players[nextTurn].bankrupt && attempts < room.players.length);
                
                room.currentTurn = nextTurn;
                const nextPlayer = room.players[nextTurn];
                
                io.to(roomId).emit('turnChanged', {
                    currentTurn: nextTurn,
                    currentPlayer: nextPlayer.name
                });
                
                if (nextPlayer.isRobot && !nextPlayer.bankrupt) {
                    setTimeout(() => handleRobotTurn(roomId), 1000);
                }
            }, 500);
            return;
        }

        const dice = Math.floor(Math.random() * 6) + 1;
        const oldPosition = player.position;
        player.position = (player.position + dice) % 40;

        const passedStart = oldPosition > player.position && player.position !== 0;
        if (passedStart) {
            player.money += 2000;
        }

        const cell = room.board[player.position];
        let landAction = null;
        let chanceCard = null;

        if (cell.type === 'property') {
            if (cell.owner && cell.owner !== player.name) {
                const owner = room.players.find(p => p.name === cell.owner);
                let rentAmount;
                if (cell.isApartment) {
                    rentAmount = cell.rentApartment;
                } else if (cell.houses === 2) {
                    rentAmount = cell.rent2;
                } else if (cell.houses === 1) {
                    rentAmount = cell.rent1;
                } else {
                    rentAmount = cell.rentBase;
                }
                
                if (player.money >= rentAmount) {
                    player.money -= rentAmount;
                    if (owner) {
                        owner.money += rentAmount;
                    }
                    landAction = { type: 'rent', amount: rentAmount, owner: cell.owner, ownerPiece: owner?.piece };
                } else {
                    player.bankrupt = true;
                    
                    room.board.forEach(c => {
                        if (c.owner === player.name) {
                            c.owner = null;
                            c.houses = 0;
                            c.isApartment = false;
                        }
                    });
                    
                    landAction = { type: 'bankrupt', amount: rentAmount };
                }
            } else if (!cell.owner) {
                if (player.money >= cell.price) {
                    player.money -= cell.price;
                    cell.owner = player.name;
                    landAction = { type: 'canBuy', price: cell.price, bought: true };
                    console.log(`机器人 ${player.name} 购买了 ${cell.name}，花费 $${cell.price}`);
                } else {
                    landAction = { type: 'canBuy', price: cell.price };
                    console.log(`机器人 ${player.name} 资金不足，无法购买 ${cell.name}`);
                }
            } else if (cell.owner === player.name && !cell.isApartment) {
                landAction = { type: 'canBuild', houses: cell.houses, housePrice: cell.housePrice };
                if (player.money >= cell.housePrice) {
                    player.money -= cell.housePrice;
                    cell.houses++;
                    if (cell.houses >= 3) {
                        cell.isApartment = true;
                    }
                    landAction = { type: 'canBuild', houses: cell.houses, housePrice: cell.housePrice, built: true };
                    console.log(`机器人 ${player.name} 在 ${cell.name} 建房，花费 $${cell.housePrice}`);
                }
            }
        } else if (cell.type === 'tax') {
            if (player.money >= cell.price) {
                player.money -= cell.price;
                landAction = { type: 'tax', amount: cell.price };
            } else {
                player.bankrupt = true;
                room.board.forEach(c => {
                    if (c.owner === player.name) {
                        c.owner = null;
                        c.houses = 0;
                        c.isApartment = false;
                    }
                });
                landAction = { type: 'bankrupt', amount: cell.price };
            }
        } else if (cell.type === 'jail') {
            player.skipTurn = true;
            landAction = { type: 'jail' };
        } else if (cell.type === 'chance') {
            chanceCard = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
            
            if (chanceCard.money) {
                player.money += chanceCard.money;
            }
            if (chanceCard.steps) {
                const oldPos = player.position;
                player.position = (player.position + chanceCard.steps + 40) % 40;
                
                if (chanceCard.steps > 0 && oldPos > player.position) {
                    player.money += 2000;
                } else if (chanceCard.steps < 0 && oldPos < player.position) {
                    player.money += 2000;
                }
            }
            
            landAction = { type: 'chance', card: chanceCard };
        }

        const finalCell = room.board[player.position];

        io.to(roomId).emit('diceRolled', {
            playerName: player.name,
            dice,
            oldPosition,
            newPosition: player.position,
            passedStart,
            landAction,
            chanceCard,
            cell: {
                index: finalCell.index,
                type: finalCell.type,
                name: finalCell.name,
                desc: finalCell.desc,
                price: finalCell.price,
                housePrice: finalCell.housePrice,
                rentBase: finalCell.rentBase,
                rent1: finalCell.rent1,
                rent2: finalCell.rent2,
                rentApartment: finalCell.rentApartment,
                owner: finalCell.owner,
                houses: finalCell.houses,
                isApartment: finalCell.isApartment
            },
            players: room.players.map(p => ({ 
                name: p.name, 
                money: p.money, 
                position: p.position, 
                piece: p.piece 
            })),
            currentTurn: room.currentTurn
        });

        const animationDelay = 500 + dice * 200 + 300;
        
        if (landAction?.bought) {
            setTimeout(() => {
                const room = monopolyRooms.get(roomId);
                if (!room) return;
                
                const colorIndex = PIECES.indexOf(player.piece);
                const playerColor = colorIndex >= 0 ? PIECE_COLORS[colorIndex] : '#fff';
                
                io.to(roomId).emit('propertyBought', {
                    position: player.position,
                    owner: player.name,
                    ownerPiece: player.piece,
                    ownerColor: playerColor,
                    players: room.players.map(p => ({ 
                        name: p.name, 
                        money: p.money,
                        piece: p.piece
                    })),
                    board: room.board.map(c => ({
                        index: c.index,
                        owner: c.owner,
                        houses: c.houses,
                        isApartment: c.isApartment
                    })),
                    currentTurn: room.currentTurn,
                    currentPlayer: player.name
                });
            }, animationDelay);
        }

        if (landAction?.built) {
            setTimeout(() => {
                const room = monopolyRooms.get(roomId);
                if (!room) return;
                
                io.to(roomId).emit('houseBuilt', {
                    position: player.position,
                    owner: player.name,
                    cellName: cell.name,
                    houses: cell.houses,
                    isApartment: cell.isApartment,
                    players: room.players.map(p => ({ 
                        name: p.name, 
                        money: p.money,
                        piece: p.piece
                    })),
                    board: room.board.map(c => ({
                        index: c.index,
                        owner: c.owner,
                        houses: c.houses,
                        isApartment: c.isApartment
                    })),
                    currentTurn: room.currentTurn,
                    currentPlayer: player.name
                });
            }, animationDelay);
        }

        const totalDelay = Math.max(animationDelay + 1500, 2500);
        console.log(`机器人 ${player.name} 回合结束，准备下一个玩家`);
        setTimeout(() => nextRobotTurn(roomId), totalDelay);
    }, 800);
}

function nextRobotTurn(roomId) {
    const room = monopolyRooms.get(roomId);
    if (!room || !room.started) return;

    let nextTurn = room.currentTurn;
    let attempts = 0;
    
    do {
        nextTurn = (nextTurn + 1) % room.players.length;
        attempts++;
    } while (room.players[nextTurn].bankrupt && attempts < room.players.length);

    const activePlayers = room.players.filter(p => !p.bankrupt);
    if (activePlayers.length <= 1) {
        const winner = activePlayers[0];
        if (winner) {
            announceMonopolyWinner(roomId, winner.name);
        }
        return;
    }

    room.currentTurn = nextTurn;
    
    const nextPlayer = room.players[nextTurn];
    console.log(`nextRobotTurn: 下一个玩家 ${nextPlayer.name}, isRobot: ${nextPlayer.isRobot}`);
    
    io.to(roomId).emit('turnChanged', {
        currentTurn: nextTurn,
        currentPlayer: nextPlayer.name
    });

    if (nextPlayer.isRobot && !nextPlayer.bankrupt) {
        console.log(`触发机器人 ${nextPlayer.name} 的回合`);
        setTimeout(() => handleRobotTurn(roomId), 1000);
    }
}

function announceMonopolyWinner(roomId, winnerName) {
    const room = monopolyRooms.get(roomId);
    const players = room ? room.players.map(p => p.name).filter(n => n !== winnerName) : [];
    
    io.to(roomId).emit('gameWinner', { winner: winnerName });
    
    const resultText = `🌍 大富翁结束！\n🏆 ${winnerName} 获胜！`;
    io.emit('gameResult', {
        text: resultText,
        gameType: 'monopoly',
        winner: winnerName,
        players: room ? room.players.map(p => p.name) : [winnerName],
        time: new Date().toLocaleTimeString()
    });
    
    monopolyRooms.delete(roomId);
}

function handleMonopolyPlayerExit(roomId, socketId, reason = 'exit') {
    const room = monopolyRooms.get(roomId);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(p => p.socketId === socketId);
    if (playerIndex === -1) return;
    
    const player = room.players[playerIndex];
    if (player.isRobot) return;
    
    if (room.started) {
        player.bankrupt = true;
        
        room.board.forEach(cell => {
            if (cell.owner === player.name) {
                cell.owner = null;
                cell.houses = 0;
                cell.isApartment = false;
            }
        });
        
        io.to(roomId).emit('playerBankrupt', {
            playerName: player.name,
            board: room.board.map(c => ({
                index: c.index,
                owner: c.owner,
                houses: c.houses,
                isApartment: c.isApartment
            }))
        });
        
        const activePlayers = room.players.filter(p => !p.bankrupt);
        if (activePlayers.length === 1) {
            announceMonopolyWinner(roomId, activePlayers[0].name);
            return;
        }
        
        if (room.currentTurn === playerIndex) {
            let nextTurn = playerIndex;
            let attempts = 0;
            do {
                nextTurn = (nextTurn + 1) % room.players.length;
                attempts++;
            } while (room.players[nextTurn].bankrupt && attempts < room.players.length);
            
            room.currentTurn = nextTurn;
            const nextPlayer = room.players[nextTurn];
            
            io.to(roomId).emit('turnChanged', {
                currentTurn: nextTurn,
                currentPlayer: nextPlayer.name
            });
            
            if (nextPlayer.isRobot && !nextPlayer.bankrupt) {
                setTimeout(() => handleRobotTurn(roomId), 1000);
            }
        }
        
        console.log(`大富翁玩家${reason === 'disconnect' ? '断线' : '退出'}破产:`, player.name, roomId);
    } else {
        const isHost = player.isHost;
        room.players.splice(playerIndex, 1);
        
        if (room.players.length === 0 || isHost) {
            // 房主退出或房间为空，但保留房间让房主可以重新加入
            room.pendingDelete = true;
            room.deleteTimeout = setTimeout(() => {
                const r = monopolyRooms.get(roomId);
                if (r && r.pendingDelete && r.players.length === 0) {
                    monopolyRooms.delete(roomId);
                    io.emit('monopolyRoomEnded', { roomId });
                    console.log('大富翁房间超时销毁:', roomId);
                }
            }, 30000);
            console.log('大富翁房间等待房主重新加入:', roomId);
        } else {
            io.to(roomId).emit('waitingForMonopolyPlayer', {
                players: room.players.map(p => ({ name: p.name, money: p.money, isHost: p.isHost, ready: p.ready }))
            });
            console.log('大富翁玩家退出:', player.name, roomId);
        }
    }
}

const APP_VERSION = '1.7.0';
const CHANGELOG = [
    {
        version: '1.7.0',
        date: '2026-03-20',
        changes: [
            '新增大富翁游戏（2-5人）',
            '优化房主判断逻辑',
            '新增16种可选棋子'
        ]
    },
    {
        version: '1.6.0',
        date: '2026-03-20',
        changes: [
            '新增房间名称修改功能（房主可设置）',
            '修复密码验证绕过问题',
            '修复未加入用户可发送消息的问题'
        ]
    },
    {
        version: '1.5.0',
        date: '2026-03-20',
        changes: [
            '新增房间密码功能（房主可设置）',
            '新增强制刷新功能（房主可触发）',
            '优化艾特已读状态显示',
            '修复emoji雨彩蛋全员可见'
        ]
    },
    {
        version: '1.4.0',
        date: '2026-03-19',
        changes: [
            '新增翻翻乐游戏',
            '支持双人对战',
            '卡牌动画效果优化'
        ]
    },
    {
        version: '1.3.0',
        date: '2026-03-18',
        changes: [
            '新增更新日志功能',
            '有新版本时会发送系统消息提醒',
            '优化版本更新提示体验'
        ]
    },
    {
        version: '1.2.0',
        date: '2026-03-17',
        changes: [
            '新增金钩钓鱼游戏',
            '支持2-4人在线对战',
            '新增观战功能'
        ]
    },
    {
        version: '1.1.0',
        date: '2026-03-16',
        changes: [
            '新增五子棋对战游戏',
            '支持图片消息发送',
            '新增@提醒功能'
        ]
    },
    {
        version: '1.0.0',
        date: '2026-03-15',
        changes: [
            '局域网聊天室上线',
            '支持实时消息收发',
            '支持深色/浅色主题切换',
            '支持自定义头像和备注'
        ]
    }
];

function getUserIP(socket) {
    return socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() 
        || socket.handshake.address 
        || socket.conn.remoteAddress 
        || 'unknown';
}

function getGameRoomInfo(roomId) {
    const room = gameRooms.get(roomId);
    if (!room) return null;
    return {
        player1: room.playerNames[0],
        player2: room.playerNames[1],
        moves: room.moves || [],
        currentTurn: room.currentTurn || 'black'
    };
}

io.on('connection', (socket) => {
    console.log('用户连接:', socket.id, 'IP:', getUserIP(socket));
    
    const clientVersion = socket.handshake.query.version || '0';
    if (clientVersion !== APP_VERSION) {
        setTimeout(() => {
            socket.emit('newVersion', {
                version: APP_VERSION,
                changes: CHANGELOG[0].changes
            });
        }, 2000);
    }
    
    socket.emit('versionInfo', { version: APP_VERSION, changelog: CHANGELOG });
    
    socket.on('checkPassword', (data, callback) => {
        const userIP = getUserIP(socket);
        console.log('checkPassword:', { userIP, roomPassword, authenticatedUsers: Array.from(authenticatedUsers) });
        
        if (!roomPassword) {
            console.log('checkPassword: 没有设置密码');
            callback({ needPassword: false });
            return;
        }
        
        if (authenticatedUsers.has(userIP)) {
            console.log('checkPassword: 用户已认证');
            callback({ needPassword: false });
            return;
        }
        
        console.log('checkPassword: 需要密码');
        callback({ needPassword: true });
    });
    
    socket.on('join', (data) => {
        const username = typeof data === 'string' ? data : data.username;
        const password = typeof data === 'object' ? data.password : null;
        const userIP = getUserIP(socket);
        
        console.log('join event:', { username, password, userIP, roomPassword, authenticatedUsers: Array.from(authenticatedUsers) });
        
        if (!username || !username.trim()) {
            console.log('用户名为空');
            socket.emit('joinError', { message: '请输入用户名' });
            return;
        }
        
        if (roomPassword && !authenticatedUsers.has(userIP)) {
            console.log('需要密码验证');
            if (password !== roomPassword) {
                console.log('密码错误或未提供');
                socket.emit('joinError', { message: '密码错误' });
                return;
            }
            console.log('密码正确，添加到认证列表');
            authenticatedUsers.add(userIP);
        }
        
        const existingUser = Array.from(users.values()).find(u => u.ip === userIP);
        const existingProfile = userProfiles.get(userIP);
        
        users.set(socket.id, { 
            username, 
            ip: userIP,
            joinTime: new Date(),
            avatar: existingProfile?.avatar || '',
            avatarColor: existingProfile?.avatarColor || ''
        });
        
        if (!existingUser) {
            io.emit('system', `${username} 加入了聊天室`);
        }
        
        broadcastUserList();
        socket.emit('system', `欢迎 ${username}！当前在线 ${getUniqueUserCount()} 人`);
        socket.emit('myInfo', { ip: userIP, username, isHost: userIP === serverIP, roomName });
    });
    
    socket.on('setRoomPassword', (data, callback) => {
        const userIP = getUserIP(socket);
        
        if (userIP !== serverIP) {
            if (callback) callback({ success: false, message: '只有房主可以设置密码' });
            return;
        }
        
        roomPassword = data.password || null;
        if (roomPassword && !authenticatedUsers.has(userIP)) {
            authenticatedUsers.add(userIP);
        }
        
        if (callback) callback({ success: true, password: roomPassword });
    });
    
    socket.on('getRoomPassword', (callback) => {
        const userIP = getUserIP(socket);
        
        if (userIP !== serverIP) {
            if (callback) callback({ success: false, message: '只有房主可以查看密码' });
            return;
        }
        
        if (callback) callback({ success: true, password: roomPassword });
    });
    
    socket.on('removeRoomPassword', (callback) => {
        const userIP = getUserIP(socket);
        
        if (userIP !== serverIP) {
            if (callback) callback({ success: false, message: '只有房主可以移除密码' });
            return;
        }
        
        roomPassword = null;
        authenticatedUsers.clear();
        
        if (callback) callback({ success: true });
    });
    
    socket.on('forceUpdate', (callback) => {
        const userIP = getUserIP(socket);
        
        if (userIP !== serverIP) {
            if (callback) callback({ success: false, message: '只有房主可以强制更新' });
            return;
        }
        
        io.emit('forceRefresh');
        
        if (callback) callback({ success: true });
    });
    
    socket.on('setRoomName', (data, callback) => {
        const userIP = getUserIP(socket);
        
        if (userIP !== serverIP) {
            if (callback) callback({ success: false, message: '只有房主可以修改房间名称' });
            return;
        }
        
        const newName = (data.name || '局域网聊天室').trim().substring(0, 30);
        roomName = newName;
        io.emit('roomNameUpdate', { name: roomName });
        
        if (callback) callback({ success: true, name: roomName });
    });
    
    function getUniqueUserCount() {
        const uniqueIPs = new Set(Array.from(users.values()).map(u => u.ip));
        return uniqueIPs.size;
    }
    
    function broadcastUserList() {
        const seenIPs = new Set();
        const userList = [];
        
        for (const [id, data] of users.entries()) {
            if (!seenIPs.has(data.ip)) {
                seenIPs.add(data.ip);
                userList.push({
                    id,
                    username: data.username,
                    ip: data.ip,
                    joinTime: data.joinTime,
                    avatar: data.avatar || '',
                    avatarColor: data.avatarColor || ''
                });
            }
        }
        
        console.log('broadcastUserList:', userList.map(u => ({ username: u.username, avatar: u.avatar, avatarColor: u.avatarColor })));
        io.emit('userList', userList);
    }
    
    socket.on('updateProfile', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        
        console.log('updateProfile 收到:', data);
        
        const oldUsername = user.username;
        
        if (data.username && data.username.trim()) {
            user.username = data.username.trim();
        }
        if (data.avatar !== undefined) {
            user.avatar = data.avatar;
        }
        if (data.avatarColor !== undefined) {
            user.avatarColor = data.avatarColor;
        }
        
        console.log('更新后用户数据:', { avatar: user.avatar, avatarColor: user.avatarColor });
        
        userProfiles.set(user.ip, {
            avatar: user.avatar,
            avatarColor: user.avatarColor
        });
        
        if (oldUsername !== user.username) {
            io.emit('system', `${oldUsername} 改名为 ${user.username}`);
        }
        
        broadcastUserList();
    });
    
    socket.on('getUserInfo', (targetSocketId) => {
        const user = users.get(targetSocketId);
        if (user) {
            socket.emit('userInfo', {
                id: targetSocketId,
                username: user.username,
                ip: user.ip,
                joinTime: user.joinTime
            });
        }
    });
    
    socket.on('message', (data, callback) => {
        const user = users.get(socket.id);
        if (!user) {
            console.log('拒绝未加入用户的消息');
            return;
        }
        const username = user.username || '匿名';
        const userIP = user.ip || 'unknown';
        
        const messageId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const mentionRegex = /@([^\s@]+)/g;
        const mentions = [];
        let match;
        while ((match = mentionRegex.exec(data.text || '')) !== null) {
            if (!mentions.includes(match[1])) {
                mentions.push(match[1]);
            }
        }
        
        const messageData = {
            username: username,
            ip: userIP,
            text: data.text || '',
            type: data.type || 'text',
            image: data.image || null,
            time: new Date().toLocaleTimeString(),
            id: messageId,
            senderId: socket.id,
            mentions: mentions,
            readBy: {}
        };
        
        io.emit('message', messageData);
        
        if (callback) {
            callback({ status: 'ok', messageId });
        }
    });
    
    socket.on('typing', (isTyping) => {
        const user = users.get(socket.id);
        if (user) {
            socket.broadcast.emit('typing', { 
                username: user.username, 
                ip: user.ip,
                isTyping 
            });
        }
    });

    socket.on('emojiRain', (data) => {
        console.log('收到emojiRain事件:', data);
        io.emit('emojiRain', data);
    });

    const messageReadStatus = new Map();

    socket.on('mentionRead', (data) => {
        const { messageId, mentionUser, readerName } = data;
        
        if (!messageReadStatus.has(messageId)) {
            messageReadStatus.set(messageId, {});
        }
        const status = messageReadStatus.get(messageId);
        status[mentionUser] = true;
        
        io.emit('mentionReadUpdate', {
            messageId,
            mentionUser,
            read: true
        });
    });
    
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const userIP = user.ip;
            users.delete(socket.id);
            
            const stillConnected = Array.from(users.values()).some(u => u.ip === userIP);
            if (!stillConnected) {
                io.emit('system', `${user.username} 离开了聊天室`);
            }
            
            broadcastUserList();
        }
        console.log('用户断开:', socket.id);
        
        gameRooms.forEach((room, roomId) => {
            if (room.players.includes(socket.id)) {
                const otherPlayer = room.players.find(id => id !== socket.id);
                if (otherPlayer) {
                    io.to(otherPlayer).emit('opponentDisconnected');
                }
                gameRooms.delete(roomId);
            }
        });

        // 处理翻翻乐房间断开
        memoryRooms.forEach((room, roomId) => {
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                const isHost = player.isHost;
                const winnerIndex = playerIndex === 0 ? 1 : 0;
                const winner = room.players[winnerIndex];
                const originalPlayers = room.players.map(p => ({ name: p.name, score: p.score }));

                room.players.splice(playerIndex, 1);

                if (room.started) {                    
                    if (winner) {
                        io.to(roomId).emit('memoryGameOver', {
                            winnerIndex,
                            players: originalPlayers,
                            reason: 'disconnect'
                        });

                        const resultText = `🎴 翻翻乐结束！\n⚠️ ${player.name} 断线\n🏆 ${winner.name} 获胜！`;
                        io.emit('gameResult', {
                            text: resultText,
                            gameType: 'memory',
                            winner: winner.name,
                            players: [player.name, winner.name],
                            time: new Date().toLocaleTimeString(),
                            roomId: roomId,
                            result: `${player.name} 断线, ${winner.name} 获胜`
                        });
                    }

                    memoryRooms.delete(roomId);
                    io.emit('memoryRoomEnded', { roomId });
                } else if (isHost) {
                    memoryRooms.delete(roomId);
                    io.emit('memoryRoomEnded', { roomId });
                } else {
                    io.to(roomId).emit('waitingForMemoryPlayer', {
                        players: room.players.map(p => ({ name: p.name, score: p.score, isHost: p.isHost }))
                    });
                }
            }
        });

        // 处理大富翁房间断开
        monopolyRooms.forEach((room, roomId) => {
            handleMonopolyPlayerExit(roomId, socket.id, 'disconnect');
        });
    });

    // 五子棋游戏 - 新的房间机制
    socket.on('createGomokuRoom', (data) => {
        let user = users.get(socket.id);
        
        if (!user && data && data.playerName) {
            user = { 
                username: data.playerName, 
                ip: getUserIP(socket),
                joinTime: new Date()
            };
            users.set(socket.id, user);
        }
        
        if (!user) {
            socket.emit('error', { message: '请先登录聊天室' });
            return;
        }

        gameRoomCounter++;
        const roomId = 'gomoku_' + gameRoomCounter;

        const room = {
            id: roomId,
            host: socket.id,
            players: [socket.id],
            playerNames: [user.username],
            playerIPs: [user.ip],
            gameType: 'gomoku',
            startTime: null,
            moves: [],
            currentTurn: 'black',
            spectators: [],
            started: false
        };

        gameRooms.set(roomId, room);
        socket.join(roomId);

        socket.emit('gomokuRoomCreated', { roomId, isHost: true });

        io.emit('gomokuRoomAvailable', {
            roomId,
            hostName: user.username,
            playerCount: 1
        });

        console.log('五子棋房间创建:', roomId, user.username);
    });

    socket.on('joinGomokuRoom', (data) => {
        const { roomId, playerName } = data;
        const room = gameRooms.get(roomId);
        let user = users.get(socket.id);

        if (!room || room.gameType !== 'gomoku') {
            socket.emit('error', { message: '房间不存在或已结束' });
            return;
        }

        if (room.started) {
            socket.emit('error', { message: '游戏已开始' });
            return;
        }

        if (room.players.length >= 2) {
            socket.emit('error', { message: '房间已满' });
            return;
        }

        if (!user && playerName) {
            user = { 
                username: playerName, 
                ip: getUserIP(socket),
                joinTime: new Date()
            };
            users.set(socket.id, user);
        }

        if (!user) {
            socket.emit('error', { message: '请先登录聊天室' });
            return;
        }

        if (room.players.includes(socket.id)) {
            socket.emit('error', { message: '你已经在这个房间了' });
            return;
        }

        // 清除待删除状态
        if (room.pendingDelete) {
            room.pendingDelete = false;
            if (room.deleteTimeout) {
                clearTimeout(room.deleteTimeout);
                room.deleteTimeout = null;
            }
        }

        room.players.push(socket.id);
        room.playerNames.push(user.username);
        room.playerIPs.push(user.ip);
        socket.join(roomId);

        socket.emit('gomokuRoomCreated', { roomId, isHost: room.players.length === 1 });

        if (room.players.length === 2) {
            room.started = true;
            room.startTime = new Date();
            
            io.to(roomId).emit('gomokuGameStart', {
                roomId,
                players: room.playerNames,
                currentTurn: 'black'
            });

            io.emit('gomokuRoomStarted', { roomId });

            io.emit('gameStart', {
                text: `⚔️ ${room.playerNames[0]} VS ${room.playerNames[1]}`,
                gameType: 'gomoku',
                players: room.playerNames,
                time: new Date().toLocaleTimeString()
            });

            io.emit('gomokuRoomEnded', { roomId });
        }

        console.log('五子棋玩家加入:', roomId, user.username);
    });

    socket.on('leaveGomokuRoom', (data) => {
        const { roomId } = data;
        const room = gameRooms.get(roomId);
        
        if (!room || room.gameType !== 'gomoku') return;

        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1) return;

        if (room.started) {
            // 游戏已开始，对方获胜
            const winnerIndex = playerIndex === 0 ? 1 : 0;
            const winnerName = room.playerNames[winnerIndex];
            
            io.to(roomId).emit('opponentDisconnected');
            
            io.emit('gameResult', {
                text: `🎯 五子棋结束！\n⚠️ 对手退出\n🏆 ${winnerName} 获胜！`,
                gameType: 'gomoku',
                winner: winnerName,
                players: room.playerNames,
                time: new Date().toLocaleTimeString()
            });

            gameRooms.delete(roomId);
            io.emit('gomokuRoomEnded', { roomId });
        } else {
            // 游戏未开始，移除玩家
            room.players.splice(playerIndex, 1);
            room.playerNames.splice(playerIndex, 1);
            room.playerIPs.splice(playerIndex, 1);
            socket.leave(roomId);

            if (room.players.length === 0) {
                // 房间空了，但保留房间让房主可以重新加入
                // 设置一个30秒超时自动删除
                room.pendingDelete = true;
                room.deleteTimeout = setTimeout(() => {
                    const r = gameRooms.get(roomId);
                    if (r && r.pendingDelete && r.players.length === 0) {
                        gameRooms.delete(roomId);
                        io.emit('gomokuRoomEnded', { roomId });
                        console.log('五子棋房间超时销毁:', roomId);
                    }
                }, 30000);
                // 不立即发送 roomEnded，让组队消息保持有效
                console.log('五子棋房间等待房主重新加入:', roomId);
            } else {
                // 更新房间信息
                room.host = room.players[0];
                io.emit('gomokuRoomUpdate', {
                    roomId,
                    hostName: room.playerNames[0],
                    playerCount: room.players.length
                });
                console.log('五子棋玩家退出:', roomId);
            }
        }
    });

    socket.on('joinGomokuGame', (data) => {
        const { roomId, playerName, isHost } = data;
        const room = gameRooms.get(roomId);
        
        if (!room || room.gameType !== 'gomoku') {
            socket.emit('error', { message: '房间不存在或已结束' });
            return;
        }

        socket.join(roomId);
        
        // 找到该玩家在房间中的索引
        const playerIndex = room.playerNames.indexOf(playerName);
        if (playerIndex !== -1) {
            // 更新该玩家的socketId（游戏窗口的socket）
            room.players[playerIndex] = socket.id;
        }

        // 如果游戏已经开始，发送当前游戏状态
        if (room.started) {
            socket.emit('gomokuGameStart', {
                roomId,
                players: room.playerNames,
                currentTurn: room.currentTurn
            });
        }

        console.log('五子棋游戏窗口加入:', playerName, roomId);
    });

    socket.on('teamInvite', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        const inviteId = Date.now() + '_' + socket.id;
        const inviteData = {
            inviteId,
            gameType: data.gameType,
            username: user.username,
            ip: user.ip,
            socketId: socket.id,
            time: new Date().toLocaleTimeString()
        };

        teamInvites.set(inviteId, inviteData);

        io.emit('teamInvite', {
            ...inviteData,
            time: new Date().toLocaleTimeString()
        });

        console.log('组队邀请:', user.username, data.gameType);
    });

    socket.on('joinTeam', (data) => {
        const invite = teamInvites.get(data.inviteId);
        const user = users.get(socket.id);

        if (!invite || !user) {
            socket.emit('teamError', { message: '组队邀请不存在或已过期' });
            return;
        }

        if (invite.socketId === socket.id) {
            socket.emit('teamError', { message: '不能加入自己发起的组队' });
            return;
        }

        gameRoomCounter++;
        const roomId = 'room_' + gameRoomCounter;

        invite.matched = true;
        teamInvites.delete(data.inviteId);

        io.emit('teamInviteMatched', {
            inviteId: data.inviteId,
            player1: invite.username,
            player2: user.username
        });

        io.to(invite.socketId).emit('teamMatched', {
            gameType: invite.gameType,
            roomId,
            isCreator: true,
            opponent: user.username
        });

        socket.emit('teamMatched', {
            gameType: invite.gameType,
            roomId,
            isCreator: false,
            opponent: invite.username
        });

        gameRooms.set(roomId, {
            players: [invite.socketId, socket.id],
            playerNames: [invite.username, user.username],
            playerIPs: [invite.ip, user.ip],
            gameType: invite.gameType,
            startTime: new Date(),
            moves: [],
            currentTurn: 'black',
            spectators: []
        });

        const gameNames = {
            'gomoku': '五子棋'
        };
        const gameName = gameNames[invite.gameType] || '游戏';
        
        io.emit('gameStart', {
            text: `⚔️ ${invite.username} VS ${user.username}`,
            gameType: invite.gameType,
            players: [invite.username, user.username],
            time: new Date().toLocaleTimeString()
        });

        io.emit('gameRoomCreated', {
            roomId,
            player1: invite.username,
            player2: user.username,
            gameType: invite.gameType
        });

        console.log('组队成功:', invite.username, 'vs', user.username, roomId);
    });

    socket.on('joinGameRoom', (data) => {
        const { roomId, isCreator } = data;
        const room = gameRooms.get(roomId);

        if (room) {
            socket.join(roomId);

            const creatorId = room.players[0];
            const joinerId = room.players[1];
            const creator = users.get(creatorId);
            const joiner = users.get(joinerId);

            io.to(roomId).emit('gameStart', {
                opponent: isCreator ? (joiner?.username || '对手') : (creator?.username || '对手'),
                opponentIp: isCreator ? joiner?.ip : creator?.ip,
                creatorName: creator?.username || '黑方',
                creatorIp: creator?.ip,
                joinerName: joiner?.username || '白方',
                joinerIp: joiner?.ip
            });
        }
    });

    socket.on('gomokuMove', (data) => {
        const room = gameRooms.get(data.roomId);
        if (room) {
            room.moves.push({ row: data.row, col: data.col, color: data.color });
            room.currentTurn = data.color === 'black' ? 'white' : 'black';
        }
        socket.to(data.roomId).emit('gomokuMove', data);
    });

    socket.on('spectateGame', (data) => {
        const { roomId } = data;
        const room = gameRooms.get(roomId);
        if (!room) {
            socket.emit('spectateError', { message: '游戏房间不存在或已结束' });
            return;
        }

        socket.join(roomId);
        room.spectators.push(socket.id);

        const creator = users.get(room.players[0]);
        const joiner = users.get(room.players[1]);

        socket.emit('spectateStart', {
            roomId,
            player1: room.playerNames[0],
            player2: room.playerNames[1],
            player1Ip: room.playerIPs[0],
            player2Ip: room.playerIPs[1],
            moves: room.moves,
            currentTurn: room.currentTurn
        });

        console.log('观战者加入:', socket.id, roomId);
    });

    socket.on('gameOver', (data) => {
        const room = gameRooms.get(data.roomId);
        if (!room) return;

        const winnerIndex = data.winner === 'black' ? 0 : 1;
        const loserIndex = 1 - winnerIndex;
        const winnerName = room.playerNames[winnerIndex];
        const loserName = room.playerNames[loserIndex];
        const winnerColor = data.winner;

        let resultText = `🎯 五子棋结束！\n🏆 ${winnerName} 获胜！`;

        if (data.reason === 'surrender') {
            resultText = `🎯 五子棋结束！\n🏳️ ${loserName} 认输\n🏆 ${winnerName} 获胜！`;
        } else if (data.reason === 'disconnect') {
            resultText = `🎯 五子棋结束！\n⚠️ 对手断线\n🏆 ${winnerName} 获胜！`;
        }

        io.emit('gameResult', {
            text: resultText,
            gameType: 'gomoku',
            winner: winnerName,
            players: room.playerNames,
            time: new Date().toLocaleTimeString()
        });

        socket.to(data.roomId).emit('opponentGameOver', data);

        io.to(data.roomId).emit('spectatorGameOver', {
            winnerName,
            winnerColor,
            reason: data.reason
        });

        gameRooms.delete(data.roomId);
        io.emit('gomokuRoomEnded', { roomId: data.roomId });
        console.log('五子棋游戏结束:', winnerName, '获胜');
    });

    socket.on('leaveGameRoom', (data) => {
        const room = gameRooms.get(data.roomId);
        if (room) {
            socket.leave(data.roomId);
        }
    });

    // 金钩钓鱼游戏
    socket.on('createFishingRoom', (data) => {
        let user = users.get(socket.id);
        
        // 如果用户不在聊天室登录列表中，使用传入的playerName
        if (!user && data && data.playerName) {
            user = { 
                username: data.playerName, 
                ip: getUserIP(socket),
                joinTime: new Date()
            };
            users.set(socket.id, user);
        }
        
        if (!user) {
            socket.emit('error', { message: '请先登录聊天室' });
            return;
        }

        fishingRoomCounter++;
        const roomId = 'fishing_' + fishingRoomCounter;

        const room = {
            id: roomId,
            host: socket.id,
            players: [{
                socketId: socket.id,
                name: user.username,
                ip: getUserIP(socket),
                cards: [],
                isHost: true,
                eliminated: false
            }],
            boardCards: [],
            currentTurn: 0,
            started: false,
            spectators: [],
            gameTimer: null,
            gameStartTime: null,
            turnTimer: null,
            turnTimeLeft: 5
        };

        fishingRooms.set(roomId, room);
        socket.join(roomId);

        socket.emit('fishingRoomCreated', { roomId, isHost: true });
        socket.emit('waitingForPlayers', { 
            players: room.players.map(p => ({ name: p.name, isHost: p.isHost }))
        });

        io.emit('fishingRoomAvailable', {
            roomId,
            hostName: user.username,
            playerCount: 1
        });

        console.log('金钩钓鱼房间创建:', roomId, user.username);
    });

    socket.on('joinFishingRoom', (data) => {
        const { roomId, isHost, isSpectator, playerName } = data;
        const room = fishingRooms.get(roomId);
        let user = users.get(socket.id);

        if (!room) {
            socket.emit('error', { message: '房间不存在或已结束' });
            return;
        }

        // 如果用户不在聊天室登录列表中，使用传入的playerName
        if (!user && playerName) {
            user = { 
                username: playerName, 
                ip: getUserIP(socket),
                joinTime: new Date()
            };
            users.set(socket.id, user);
        }

        if (!user) {
            socket.emit('error', { message: '请先登录' });
            return;
        }

        socket.join(roomId);

        if (isSpectator) {
            room.spectators.push(socket.id);
            
            socket.emit('spectateStart', {
                boardCards: room.boardCards,
                players: room.players.map(p => ({
                    name: p.name,
                    cardCount: p.cards.length,
                    eliminated: p.eliminated,
                    isHost: p.isHost
                })),
                currentTurn: room.currentTurn
            });
            return;
        }

        if (room.started) {
            // 检查是否是已存在的玩家重连
            const existingPlayer = room.players.find(p => p.name === user.username);
            if (existingPlayer) {
                existingPlayer.socketId = socket.id;
                existingPlayer.eliminated = false;
                
                // 发送当前游戏状态
                const playerIndex = room.players.indexOf(existingPlayer);
                socket.emit('gameStart', {
                    cards: existingPlayer.cards,
                    players: room.players.map(p => ({
                        name: p.name,
                        cardCount: p.cards.length,
                        eliminated: p.eliminated,
                        isHost: p.isHost
                    })),
                    playerIndex: playerIndex,
                    boardCards: room.boardCards,
                    currentTurn: room.currentTurn
                });
                return;
            }
            
            socket.emit('error', { message: '游戏已开始，只能观战' });
            return;
        }

        // 检查是否已经在玩家列表中（房主重连或刷新页面）
        const existingPlayer = room.players.find(p => p.name === user.username);
        if (existingPlayer) {
            existingPlayer.socketId = socket.id;
            
            // 如果传入 isHost 参数为 true，更新 host socket id
            if (isHost || existingPlayer.isHost) {
                room.host = socket.id;
                existingPlayer.isHost = true;
            }
            
            io.to(roomId).emit('waitingForPlayers', {
                players: room.players.map(p => ({ name: p.name, isHost: p.isHost }))
            });
            
            console.log('玩家重连金钩钓鱼房间:', user.username, roomId, 'isHost:', isHost);
            return;
        }

        if (room.players.length >= 4) {
            socket.emit('error', { message: '房间已满' });
            return;
        }

        room.players.push({
            socketId: socket.id,
            name: user.username,
            ip: getUserIP(socket),
            cards: [],
            isHost: false,
            eliminated: false
        });

        io.to(roomId).emit('waitingForPlayers', {
            players: room.players.map(p => ({ name: p.name, isHost: p.isHost }))
        });

        io.emit('fishingRoomUpdate', {
            roomId,
            playerCount: room.players.length
        });

        console.log('加入金钩钓鱼房间:', user.username, roomId);
    });

    socket.on('startFishingGame', (data) => {
        const { roomId } = data;
        const room = fishingRooms.get(roomId);

        if (!room || room.host !== socket.id) {
            return;
        }

        if (room.players.length < 2) {
            socket.emit('error', { message: '至少需要2名玩家' });
            return;
        }

        // 创建牌组
        const deck = [];
        const suits = ['♠', '♥', '♦', '♣'];
        const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

        for (const suit of suits) {
            for (const value of values) {
                deck.push({ suit, value, type: 'normal' });
            }
        }
        deck.push({ type: 'bigJoker' });
        deck.push({ type: 'smallJoker' });

        // 洗牌
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // 发牌
        const playerCount = room.players.length;
        const cardsPerPlayer = Math.floor(54 / playerCount);
        let cardIndex = 0;

        room.players.forEach((player, index) => {
            if (index < playerCount - 1) {
                player.cards = deck.slice(cardIndex, cardIndex + cardsPerPlayer);
                cardIndex += cardsPerPlayer;
            } else {
                player.cards = deck.slice(cardIndex);
            }
        });

        room.started = true;
        room.boardCards = [];
        room.currentTurn = 0;
        room.gameStartTime = Date.now();
        room.turnTimeLeft = 5;

        startGameTimer(room);
        startTurnTimer(room);

        // 通知所有玩家
        room.players.forEach((player, index) => {
            io.to(player.socketId).emit('gameStart', {
                cards: player.cards,
                players: room.players.map(p => ({
                    name: p.name,
                    cardCount: p.cards.length,
                    eliminated: p.eliminated,
                    isHost: p.isHost
                })),
                playerIndex: index,
                boardCards: [],
                currentTurn: 0,
                gameTimeLeft: 120
            });
        });

        // 通知观战者
        room.spectators.forEach(socketId => {
            io.to(socketId).emit('spectateStart', {
                boardCards: [],
                players: room.players.map(p => ({
                    name: p.name,
                    cardCount: p.cards.length,
                    eliminated: p.eliminated,
                    isHost: p.isHost
                })),
                currentTurn: 0
            });
        });

        io.emit('fishingRoomStarted', { roomId });

        io.emit('gameStart', {
            text: `👥 玩家: ${room.players.map(p => p.name).join('、')}`,
            gameType: 'fishing',
            players: room.players.map(p => p.name),
            time: new Date().toLocaleTimeString()
        });

        console.log('金钩钓鱼开始:', roomId, playerCount, '人');
    });

    socket.on('playCard', (data) => {
        const { roomId } = data;
        const room = fishingRooms.get(roomId);

        if (!room || !room.started) return;

        const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex === -1 || playerIndex !== room.currentTurn) return;

        const player = room.players[playerIndex];
        if (player.cards.length === 0 || player.eliminated) return;

        // 出牌
        const card = player.cards.shift();
        room.boardCards.push(card);

        // 检查特殊牌
        let shouldSwitchTurn = true;
        let cardsWonEmitted = false;

        if (card.type === 'bigJoker') {
            // 大王：其他玩家各支付5张
            handleJokerPayment(room, playerIndex, 5, 'bigJoker');
        } else if (card.type === 'smallJoker') {
            // 小王：其他玩家各支付3张
            handleJokerPayment(room, playerIndex, 3, 'smallJoker');
        } else if (card.value === 'J') {
            // J：获得游戏区所有牌（包括刚出的J），可以继续出牌
            shouldSwitchTurn = false;
            if (room.boardCards.length > 0) {
                const wonCards = room.boardCards.splice(0);
                player.cards.push(...wonCards);
                cardsWonEmitted = true;
                
                broadcastToRoom(room, 'cardsWon', {
                    winnerIndex: playerIndex,
                    cards: player.cards,
                    boardCards: room.boardCards,
                    players: getPlayersState(room),
                    wonCount: wonCards.length,
                    canContinue: true,
                    playedCard: card
                });
            }
        } else if (card.value === 'K') {
            // K：其他玩家各支付2张
            handleJokerPayment(room, playerIndex, 2, 'K');
        } else if (card.value === 'Q') {
            // Q：其他玩家各支付1张
            handleJokerPayment(room, playerIndex, 1, 'Q');
        } else {
            // 普通牌：检查是否有相同数字
            const matchIndex = room.boardCards.findIndex((c, i) => 
                i < room.boardCards.length - 1 && 
                c.type === 'normal' && 
                c.value === card.value
            );

            if (matchIndex !== -1) {
                shouldSwitchTurn = false;
                const wonCards = room.boardCards.splice(matchIndex);
                player.cards.push(...wonCards);
                cardsWonEmitted = true;

                broadcastToRoom(room, 'cardsWon', {
                    winnerIndex: playerIndex,
                    cards: player.cards,
                    boardCards: room.boardCards,
                    players: getPlayersState(room),
                    wonCount: wonCards.length,
                    canContinue: true,
                    playedCard: card
                });
            }
        }

        // 检查淘汰
        checkElimination(room);

        // 是否切换回合
        if (shouldSwitchTurn) {
            advanceTurn(room);
        }

        // 检查游戏结束
        if (checkGameOver(room)) {
            return;
        }

        // 重置回合计时器
        if (shouldSwitchTurn) {
            startTurnTimer(room);
        } else {
            // 玩家继续出牌，重置计时器
            room.turnTimeLeft = 5;
            io.to(player.socketId).emit('turnTimerUpdate', { timeLeft: room.turnTimeLeft });
        }

        // 广播出牌（如果已经通过cardsWon广播，则跳过）
        if (!cardsWonEmitted) {
            broadcastToRoom(room, 'cardPlayed', {
                playerIndex,
                card,
                boardCards: room.boardCards,
                currentTurn: room.currentTurn,
                players: getPlayersState(room)
            });
        }
    });

    function handleJokerPayment(room, receiverIndex, payCount, cardType) {
        const receiver = room.players[receiverIndex];

        room.players.forEach((player, index) => {
            if (index !== receiverIndex && !player.eliminated && player.cards.length > 0) {
                const actualPay = Math.min(payCount, player.cards.length);
                const paidCards = player.cards.splice(0, actualPay);
                receiver.cards.push(...paidCards);

                broadcastToRoom(room, 'payCards', {
                    payerIndex: index,
                    receiverIndex,
                    payerCards: player.cards,
                    receiverCards: receiver.cards,
                    payCount: actualPay,
                    players: getPlayersState(room)
                });

                if (player.cards.length === 0) {
                    player.eliminated = true;
                    broadcastToRoom(room, 'playerEliminated', {
                        playerIndex: index,
                        players: getPlayersState(room)
                    });
                }
            }
        });
    }

    function checkElimination(room) {
        room.players.forEach((player, index) => {
            if (player.cards.length === 0 && !player.eliminated) {
                player.eliminated = true;
                broadcastToRoom(room, 'playerEliminated', {
                    playerIndex: index,
                    players: getPlayersState(room)
                });
            }
        });
    }

    function advanceTurn(room) {
        const activePlayers = room.players.filter(p => !p.eliminated && p.cards.length > 0);
        if (activePlayers.length <= 1) return;

        do {
            room.currentTurn = (room.currentTurn + 1) % room.players.length;
        } while (room.players[room.currentTurn].eliminated || room.players[room.currentTurn].cards.length === 0);
    }

    function checkGameOver(room) {
        const activePlayers = room.players.filter(p => !p.eliminated && p.cards.length > 0);

        if (activePlayers.length <= 1) {
            const winnerIndex = room.players.findIndex(p => !p.eliminated && p.cards.length > 0);
            
            // 计算排名
            const rankings = [];
            const eliminated = room.players.filter(p => p.eliminated);
            eliminated.reverse().forEach(p => {
                rankings.push({
                    playerIndex: room.players.indexOf(p),
                    name: p.name
                });
            });

            if (winnerIndex !== -1) {
                rankings.unshift({
                    playerIndex: winnerIndex,
                    name: room.players[winnerIndex].name
                });
            }

            broadcastToRoom(room, 'gameOver', {
                winnerIndex,
                rankings,
                players: getPlayersState(room)
            });

            if (room.gameTimer) clearInterval(room.gameTimer);
            if (room.turnTimer) clearInterval(room.turnTimer);

            // 广播游戏结果到群聊
            const winnerName = winnerIndex !== -1 ? room.players[winnerIndex].name : '无';
            const playerNames = room.players.map(p => p.name).join('、');
            const resultText = `🎣 金钩钓鱼结束！\n🏆 ${winnerName} 获胜！\n👥 ${playerNames}`;

            io.emit('gameResult', {
                text: resultText,
                gameType: 'fishing',
                winner: winnerName,
                players: room.players.map(p => p.name),
                time: new Date().toLocaleTimeString()
            });

            fishingRooms.delete(room.id);
            io.emit('fishingRoomEnded', { roomId: room.id });

            console.log('金钩钓鱼结束:', room.id, winnerIndex !== -1 ? room.players[winnerIndex].name : '无胜者');
            return true;
        }

        return false;
    }

    function getPlayersState(room) {
        return room.players.map(p => ({
            name: p.name,
            cardCount: p.cards.length,
            eliminated: p.eliminated,
            isHost: p.isHost
        }));
    }

    function broadcastToRoom(room, event, data) {
        room.players.forEach(player => {
            io.to(player.socketId).emit(event, data);
        });
        room.spectators.forEach(socketId => {
            io.to(socketId).emit(event, data);
        });
    }

    function startGameTimer(room) {
        if (room.gameTimer) clearInterval(room.gameTimer);
        
        room.gameTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - room.gameStartTime) / 1000);
            const timeLeft = Math.max(0, 120 - elapsed);
            
            broadcastToRoom(room, 'gameTimerUpdate', { timeLeft });
            
            if (timeLeft <= 0) {
                clearInterval(room.gameTimer);
                clearInterval(room.turnTimer);
                endGameByTime(room);
            }
        }, 1000);
    }

    function startTurnTimer(room) {
        if (room.turnTimer) clearInterval(room.turnTimer);
        
        room.turnTimeLeft = 5;
        
        const currentPlayer = room.players[room.currentTurn];
        if (!currentPlayer || currentPlayer.eliminated || currentPlayer.cards.length === 0) {
            advanceTurn(room);
            return;
        }

        io.to(currentPlayer.socketId).emit('turnTimerUpdate', { timeLeft: room.turnTimeLeft });
        
        room.turnTimer = setInterval(() => {
            room.turnTimeLeft--;
            
            io.to(currentPlayer.socketId).emit('turnTimerUpdate', { timeLeft: room.turnTimeLeft });
            
            if (room.turnTimeLeft <= 0) {
                clearInterval(room.turnTimer);
                handleTurnTimeout(room);
            }
        }, 1000);
    }

    function handleTurnTimeout(room) {
        const currentPlayer = room.players[room.currentTurn];
        if (!currentPlayer || currentPlayer.eliminated) {
            advanceTurn(room);
            startTurnTimer(room);
            return;
        }

        room.players.forEach((player, index) => {
            if (index !== room.currentTurn && !player.eliminated && currentPlayer.cards.length > 0) {
                const paidCard = currentPlayer.cards.shift();
                player.cards.push(paidCard);
                
                broadcastToRoom(room, 'payCards', {
                    payerIndex: room.currentTurn,
                    receiverIndex: index,
                    payerCards: currentPlayer.cards,
                    receiverCards: player.cards,
                    payCount: 1,
                    players: getPlayersState(room)
                });
            }
        });

        broadcastToRoom(room, 'timeoutPenalty', {
            playerIndex: room.currentTurn,
            playerName: currentPlayer.name
        });

        if (currentPlayer.cards.length === 0) {
            currentPlayer.eliminated = true;
            broadcastToRoom(room, 'playerEliminated', {
                playerIndex: room.currentTurn,
                players: getPlayersState(room)
            });
        }

        if (checkGameOver(room)) {
            return;
        }

        advanceTurn(room);
        startTurnTimer(room);
    }

    function endGameByTime(room) {
        if (room.gameTimer) clearInterval(room.gameTimer);
        if (room.turnTimer) clearInterval(room.turnTimer);

        const sortedPlayers = room.players
            .map((p, i) => ({ playerIndex: i, name: p.name, cardCount: p.cards.length, eliminated: p.eliminated }))
            .sort((a, b) => b.cardCount - a.cardCount);

        const rankings = sortedPlayers.map(p => ({
            playerIndex: p.playerIndex,
            name: p.name,
            cardCount: p.cardCount
        }));

        const winnerIndex = sortedPlayers[0].playerIndex;

        broadcastToRoom(room, 'gameOver', {
            winnerIndex,
            rankings,
            players: getPlayersState(room),
            reason: 'timeout'
        });

        // 广播游戏结果到群聊
        const winnerName = room.players[winnerIndex].name;
        const playerNames = room.players.map(p => p.name).join('、');
        const resultText = `🎣 金钩钓鱼结束！\n🏆 ${winnerName} 获胜！(${sortedPlayers[0].cardCount}张牌)`;

        io.emit('gameResult', {
            text: resultText,
            gameType: 'fishing',
            winner: winnerName,
            players: room.players.map(p => p.name),
            time: new Date().toLocaleTimeString()
        });

        fishingRooms.delete(room.id);
        io.emit('fishingRoomEnded', { roomId: room.id });

        console.log('金钩钓鱼超时结束:', room.id, room.players[winnerIndex].name, '获胜');
    }

    socket.on('leaveFishingRoom', (data) => {
        const room = fishingRooms.get(data.roomId);
        if (room) {
            socket.leave(data.roomId);
        }
    });

    // 翻翻乐游戏
    const MEMORY_EMOJIS = [
        '🍎', '🍊', '🍋', '🍇', '🍓', '🍑', '🍒', '🥝', '🍍', '🥭', '🍌', '🍉', '🫐', '🥥', '🍈', '🍐',
        '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🦄'
    ];

    socket.on('createMemoryRoom', (data) => {
        let user = users.get(socket.id);
        
        if (!user && data && data.playerName) {
            user = { 
                username: data.playerName, 
                ip: getUserIP(socket),
                joinTime: new Date()
            };
            users.set(socket.id, user);
        }
        
        if (!user) {
            socket.emit('error', { message: '请先登录聊天室' });
            return;
        }

        memoryRoomCounter++;
        const roomId = 'memory_' + memoryRoomCounter;

        const room = {
            id: roomId,
            host: socket.id,
            players: [{
                socketId: socket.id,
                name: user.username,
                ip: getUserIP(socket),
                score: 0,
                collected: [],
                isHost: true
            }],
            currentTurn: 0,
            firstCard: null,
            secondCard: null,
            cards: [],
            started: false,
            matchedPairs: 0
        };

        memoryRooms.set(roomId, room);
        socket.join(roomId);

        socket.emit('memoryRoomCreated', { roomId, isHost: true });
        socket.emit('waitingForMemoryPlayer', { 
            players: room.players.map(p => ({ name: p.name, score: p.score, isHost: p.isHost }))
        });

        io.emit('memoryRoomAvailable', {
            roomId,
            hostName: user.username
        });

        console.log('翻翻乐房间创建:', roomId, user.username);
    });

    socket.on('joinMemoryRoom', (data) => {
        const { roomId, playerName } = data;
        const room = memoryRooms.get(roomId);
        let user = users.get(socket.id);

        if (!room) {
            socket.emit('error', { message: '房间不存在或已结束' });
            return;
        }

        // 清除待删除状态
        if (room.pendingDelete) {
            room.pendingDelete = false;
            if (room.deleteTimeout) {
                clearTimeout(room.deleteTimeout);
                room.deleteTimeout = null;
            }
        }

        if (!user && playerName) {
            user = { 
                username: playerName, 
                ip: getUserIP(socket),
                joinTime: new Date()
            };
            users.set(socket.id, user);
        }

        if (!user) {
            socket.emit('error', { message: '请先登录' });
            return;
        }

        if (room.started) {
            socket.emit('error', { message: '游戏已开始' });
            return;
        }

        socket.join(roomId);

        // 检查是否已经在玩家列表中（房主重连或刷新页面）
        const existingPlayer = room.players.find(p => p.name === user.username);
        if (existingPlayer) {
            existingPlayer.socketId = socket.id;
            // 如果是房主重连，更新 room.host
            if (existingPlayer.isHost) {
                room.host = socket.id;
            }
            io.to(roomId).emit('waitingForMemoryPlayer', {
                players: room.players.map(p => ({ name: p.name, score: p.score, isHost: p.isHost }))
            });
            console.log('翻翻乐玩家重连:', user.username, roomId);
            return;
        }

        if (room.players.length >= 2) {
            socket.emit('error', { message: '房间已满' });
            return;
        }

        room.players.push({
            socketId: socket.id,
            name: user.username,
            ip: getUserIP(socket),
            score: 0,
            collected: [],
            isHost: false
        });

        io.to(roomId).emit('waitingForMemoryPlayer', {
            players: room.players.map(p => ({ name: p.name, score: p.score, isHost: p.isHost }))
        });

        console.log('加入翻翻乐房间:', user.username, roomId);
    });

    socket.on('startMemoryGame', (data) => {
        const { roomId } = data;
        const room = memoryRooms.get(roomId);

        if (!room) {
            socket.emit('error', { message: '房间不存在' });
            return;
        }

        if (room.host !== socket.id) {
            socket.emit('error', { message: '只有房主才能开始游戏' });
            return;
        }

        if (room.players.length !== 2) {
            socket.emit('error', { message: '需要2名玩家才能开始' });
            return;
        }

        // 创建6x6卡牌 (18对)
        const selectedEmojis = MEMORY_EMOJIS.slice(0, 18);
        const cards = [];
        
        selectedEmojis.forEach((emoji, index) => {
            cards.push({ id: index * 2, emoji, pairId: index });
            cards.push({ id: index * 2 + 1, emoji, pairId: index });
        });

        // 洗牌
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }

        room.cards = cards.map((card, index) => ({
            ...card,
            index,
            flipped: false,
            matched: false
        }));

        room.currentTurn = 0;
        room.firstCard = null;
        room.secondCard = null;
        room.matchedPairs = 0;

        console.log('发送倒计时到房间:', roomId);

        // 发送倒计时
        io.to(roomId).emit('memoryGameCountdown', {
            players: room.players.map(p => ({ name: p.name, score: p.score, isHost: p.isHost }))
        });

        // 3秒后发送游戏开始
        setTimeout(() => {
            const currentRoom = memoryRooms.get(roomId);
            if (currentRoom) {
                currentRoom.started = true;
                io.to(roomId).emit('memoryGameStart', {
                    cards: currentRoom.cards,
                    players: currentRoom.players.map(p => ({ name: p.name, score: p.score, isHost: p.isHost })),
                    currentTurn: currentRoom.currentTurn
                });
                io.emit('memoryRoomStarted', { roomId });
                
                io.emit('gameStart', {
                    text: `⚔️ ${currentRoom.players[0]?.name} VS ${currentRoom.players[1]?.name}`,
                    gameType: 'memory',
                    players: currentRoom.players.map(p => p.name),
                    time: new Date().toLocaleTimeString()
                });
                
                console.log('翻翻乐开始:', roomId);
            }
        }, 3000);
    });

    socket.on('flipMemoryCard', (data) => {
        const { roomId, cardIndex } = data;
        const room = memoryRooms.get(roomId);

        if (!room || !room.started) return;

        const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex === -1 || playerIndex !== room.currentTurn) return;

        const card = room.cards[cardIndex];
        if (card.flipped || card.matched) return;

        card.flipped = true;

        if (!room.firstCard) {
            room.firstCard = card;
            io.to(roomId).emit('memoryCardFlipped', {
                cardIndex,
                emoji: card.emoji,
                playerIndex
            });
        } else {
            room.secondCard = card;
            io.to(roomId).emit('memoryCardFlipped', {
                cardIndex,
                emoji: card.emoji,
                playerIndex
            });

            // 检查是否匹配
            setTimeout(() => {
                const currentRoom = memoryRooms.get(roomId);
                if (!currentRoom || !currentRoom.firstCard || !currentRoom.secondCard) {
                    return;
                }

                const firstCard = currentRoom.firstCard;
                const secondCard = currentRoom.secondCard;

                if (firstCard.pairId === secondCard.pairId) {
                    // 匹配成功
                    firstCard.matched = true;
                    secondCard.matched = true;
                    currentRoom.players[playerIndex].score++;
                    currentRoom.players[playerIndex].collected.push(firstCard.emoji);
                    currentRoom.matchedPairs++;

                    io.to(roomId).emit('memoryMatch', {
                        cardIndices: [currentRoom.cards.indexOf(firstCard), currentRoom.cards.indexOf(secondCard)],
                        playerIndex,
                        score: currentRoom.players[playerIndex].score,
                        emoji: firstCard.emoji
                    });

                    currentRoom.firstCard = null;
                    currentRoom.secondCard = null;

                    // 检查游戏是否结束
                    if (currentRoom.matchedPairs >= 18) {
                        endMemoryGame(currentRoom);
                    }
                } else {
                    // 不匹配，翻回去
                    io.to(roomId).emit('memoryNoMatch', {
                        cardIndices: [currentRoom.cards.indexOf(firstCard), currentRoom.cards.indexOf(secondCard)]
                    });

                    firstCard.flipped = false;
                    secondCard.flipped = false;
                    currentRoom.firstCard = null;
                    currentRoom.secondCard = null;

                    // 切换回合
                    currentRoom.currentTurn = (currentRoom.currentTurn + 1) % 2;
                    io.to(roomId).emit('memoryTurnChange', { currentTurn: currentRoom.currentTurn });
                }
            }, 1000);
        }
    });

    function endMemoryGame(room) {
        const player1 = room.players[0];
        const player2 = room.players[1];
        
        let winnerIndex;
        if (player1.score > player2.score) {
            winnerIndex = 0;
        } else if (player2.score > player1.score) {
            winnerIndex = 1;
        } else {
            winnerIndex = -1; // 平局
        }

        io.to(room.id).emit('memoryGameOver', {
            winnerIndex,
            players: room.players.map(p => ({ name: p.name, score: p.score, collected: p.collected }))
        });

        // 广播游戏结果到群聊
        const winnerName = winnerIndex >= 0 ? room.players[winnerIndex].name : '平局';
        const resultText = `🎴 翻翻乐结束！\n🏆 ${winnerName} 获胜！\n📊 ${player1.score} : ${player2.score}`;

        io.emit('gameResult', {
            text: resultText,
            gameType: 'memory',
            winner: winnerName,
            players: room.players.map(p => p.name),
            time: new Date().toLocaleTimeString(),
            roomId: room.id,
            result: `${player1.name} ${player1.score} : ${player2.score} ${player2.name}`
        });

        memoryRooms.delete(room.id);
        io.emit('memoryRoomEnded', { roomId: room.id });

        console.log('翻翻乐结束:', room.id, winnerName);
    }

    socket.on('leaveMemoryRoom', (data) => {
        const { roomId } = data;
        const room = memoryRooms.get(roomId);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex === -1) {
            socket.leave(roomId);
            return;
        }

        const player = room.players[playerIndex];
        const isHost = player.isHost;
        const winnerIndex = playerIndex === 0 ? 1 : 0;
        const winner = room.players[winnerIndex];
        const originalPlayers = room.players.map(p => ({ name: p.name, score: p.score }));

        // 从玩家列表中移除
        room.players.splice(playerIndex, 1);
        socket.leave(roomId);

        if (room.started) {
            // 游戏已开始，宣告对方获胜            
            if (winner) {
                io.to(roomId).emit('memoryGameOver', {
                    winnerIndex,
                    players: originalPlayers,
                    reason: 'disconnect'
                });

                const resultText = `🎴 翻翻乐结束！\n⚠️ ${player.name} 退出\n🏆 ${winner.name} 获胜！`;
                io.emit('gameResult', {
                    text: resultText,
                    gameType: 'memory',
                    winner: winner.name,
                    players: [player.name, winner.name],
                    time: new Date().toLocaleTimeString(),
                    roomId: roomId,
                    result: `${player.name} 退出, ${winner.name} 获胜`
                });
            }

            memoryRooms.delete(roomId);
            io.emit('memoryRoomEnded', { roomId });
        } else if (isHost) {
            // 房主退出，但保留房间让房主可以重新加入
            room.pendingDelete = true;
            room.deleteTimeout = setTimeout(() => {
                const r = memoryRooms.get(roomId);
                if (r && r.pendingDelete && r.players.length === 0) {
                    memoryRooms.delete(roomId);
                    io.emit('memoryRoomEnded', { roomId });
                    console.log('翻翻乐房间超时销毁:', roomId);
                }
            }, 30000);
            console.log('翻翻乐房间等待房主重新加入:', roomId);
        } else {
            // 普通玩家退出，更新等待列表
            io.to(roomId).emit('waitingForMemoryPlayer', {
                players: room.players.map(p => ({ name: p.name, score: p.score, isHost: p.isHost }))
            });
            console.log('翻翻乐玩家退出:', player.name, roomId);
        }
    });

    // 大富翁游戏
    socket.on('createMonopolyRoom', (data) => {
        let user = users.get(socket.id);
        
        if (!user && data && data.playerName) {
            user = { 
                username: data.playerName, 
                ip: getUserIP(socket),
                joinTime: new Date()
            };
            users.set(socket.id, user);
        }
        
        if (!user) {
            socket.emit('error', { message: '请先登录聊天室' });
            return;
        }

        monopolyRoomCounter++;
        const roomId = 'monopoly_' + monopolyRoomCounter;

        const room = {
            id: roomId,
            host: socket.id,
            players: [{
                socketId: socket.id,
                name: user.username,
                ip: getUserIP(socket),
                money: 15000,
                position: 0,
                piece: null,
                isHost: true,
                ready: false
            }],
            started: false,
            currentTurn: 0,
            board: generateMonopolyBoard()
        };

        monopolyRooms.set(roomId, room);
        socket.join(roomId);

        socket.emit('monopolyRoomCreated', { roomId, isHost: true });
        socket.emit('waitingForMonopolyPlayer', { 
            players: room.players.map(p => ({ name: p.name, money: p.money, isHost: p.isHost, ready: p.ready }))
        });

        io.emit('monopolyRoomAvailable', {
            roomId,
            hostName: user.username
        });

        console.log('大富翁房间创建:', roomId, user.username);
    });

    socket.on('joinMonopolyRoom', (data) => {
        const { roomId, playerName } = data;
        const room = monopolyRooms.get(roomId);
        let user = users.get(socket.id);

        if (!room) {
            socket.emit('error', { message: '房间不存在或已结束' });
            return;
        }

        // 清除待删除状态
        if (room.pendingDelete) {
            room.pendingDelete = false;
            if (room.deleteTimeout) {
                clearTimeout(room.deleteTimeout);
                room.deleteTimeout = null;
            }
        }

        if (!user && playerName) {
            user = { 
                username: playerName, 
                ip: getUserIP(socket),
                joinTime: new Date()
            };
            users.set(socket.id, user);
        }

        if (!user) {
            socket.emit('error', { message: '请先登录' });
            return;
        }

        if (room.started) {
            socket.emit('error', { message: '游戏已开始' });
            return;
        }

        if (room.players.length >= 5) {
            socket.emit('error', { message: '房间已满' });
            return;
        }

        socket.join(roomId);

        const existingPlayer = room.players.find(p => p.name === user.username);
        if (existingPlayer) {
            existingPlayer.socketId = socket.id;
            if (existingPlayer.isHost) {
                room.host = socket.id;
            }
            io.to(roomId).emit('waitingForMonopolyPlayer', {
                players: room.players.map(p => ({ name: p.name, money: p.money, isHost: p.isHost, ready: p.ready }))
            });
            console.log('大富翁玩家重连:', user.username, roomId);
            return;
        }

        room.players.push({
            socketId: socket.id,
            name: user.username,
            ip: getUserIP(socket),
            money: 15000,
            position: 0,
            piece: null,
            isHost: false,
            ready: false,
            skipTurn: false,
            bankrupt: false,
            pendingPayment: null,
            pendingOwner: null,
            paidAmount: 0
        });

        io.to(roomId).emit('waitingForMonopolyPlayer', {
            players: room.players.map(p => ({ name: p.name, money: p.money, isHost: p.isHost, ready: p.ready }))
        });

        io.emit('monopolyRoomUpdate', {
            roomId,
            playerCount: room.players.length
        });

        console.log('大富翁玩家加入:', user.username, roomId);
    });

    socket.on('addRobot', (data) => {
        const { roomId } = data;
        const room = monopolyRooms.get(roomId);
        if (!room) return;

        if (room.host !== socket.id) {
            socket.emit('error', { message: '只有房主可以添加机器人' });
            return;
        }

        if (room.players.length >= 5) {
            socket.emit('error', { message: '房间已满' });
            return;
        }

        const robotNames = ['机器人小爱', '机器人小贝', '机器人小智', '机器人小慧'];
        const existingNames = room.players.map(p => p.name);
        const availableNames = robotNames.filter(n => !existingNames.includes(n));
        
        if (availableNames.length === 0) {
            socket.emit('error', { message: '没有可用的机器人' });
            return;
        }

        const robotName = availableNames[0];
        const robotId = 'robot_' + Date.now();

        room.players.push({
            socketId: robotId,
            name: robotName,
            ip: '127.0.0.1',
            money: 15000,
            position: 0,
            piece: null,
            isHost: false,
            ready: false,
            skipTurn: false,
            bankrupt: false,
            pendingPayment: null,
            pendingOwner: null,
            paidAmount: 0,
            isRobot: true
        });

        io.to(roomId).emit('robotAdded', {
            players: room.players.map(p => ({ 
                name: p.name, 
                money: p.money, 
                isHost: p.isHost, 
                ready: p.ready,
                isRobot: p.isRobot 
            }))
        });

        io.emit('monopolyRoomUpdate', {
            roomId,
            playerCount: room.players.length
        });

        console.log('大富翁机器人加入:', robotName, roomId);
    });

    socket.on('removeRobot', (data) => {
        const { roomId, playerIndex } = data;
        const room = monopolyRooms.get(roomId);
        if (!room) return;

        if (room.host !== socket.id) {
            socket.emit('error', { message: '只有房主可以移除机器人' });
            return;
        }

        const player = room.players[playerIndex];
        if (!player || !player.isRobot) {
            socket.emit('error', { message: '无法移除该玩家' });
            return;
        }

        room.players.splice(playerIndex, 1);

        io.to(roomId).emit('robotRemoved', {
            players: room.players.map(p => ({ 
                name: p.name, 
                money: p.money, 
                isHost: p.isHost, 
                ready: p.ready,
                isRobot: p.isRobot 
            }))
        });

        io.emit('monopolyRoomUpdate', {
            roomId,
            playerCount: room.players.length
        });

        console.log('大富翁机器人移除:', player.name, roomId);
    });

    socket.on('startMonopolySelection', (data) => {
        const { roomId } = data;
        const room = monopolyRooms.get(roomId);
        if (!room) return;

        if (room.host !== socket.id) {
            socket.emit('error', { message: '只有房主可以开始游戏' });
            return;
        }

        if (room.players.length < 1) {
            socket.emit('error', { message: '至少需要1名玩家' });
            return;
        }

        room.phase = 'selection';

        const robots = room.players.filter(p => p.isRobot);
        const usedPieces = room.players.filter(p => p.piece).map(p => p.piece);
        
        robots.forEach(robot => {
            const availablePiece = PIECES.find(p => !usedPieces.includes(p));
            if (availablePiece) {
                robot.piece = availablePiece;
                robot.ready = true;
                usedPieces.push(availablePiece);
            }
        });

        io.to(roomId).emit('monopolySelectionStarted', {
            players: room.players.map(p => ({ 
                name: p.name, 
                money: p.money, 
                isHost: p.isHost,
                piece: p.piece,
                isRobot: p.isRobot
            }))
        });

        io.emit('monopolyRoomStarted', { roomId });

        const allReady = room.players.every(p => p.piece);
        if (allReady) {
            startMonopolyGame(roomId, room);
        }

        console.log('大富翁开始选择棋子:', roomId);
    });

    socket.on('selectMonopolyPiece', (data) => {
        const { roomId, piece } = data;
        const room = monopolyRooms.get(roomId);
        if (!room) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const pieceUsed = room.players.some(p => p.piece === piece && p.socketId !== socket.id);
        if (pieceUsed) {
            socket.emit('error', { message: '该棋子已被选择' });
            return;
        }

        player.piece = piece;
        player.ready = true;

        io.to(roomId).emit('playerPieceSelected', {
            playerName: player.name,
            piece: piece,
            players: room.players.map(p => ({ name: p.name, money: p.money, piece: p.piece, isHost: p.isHost, ready: p.ready, isRobot: p.isRobot }))
        });

        const allReady = room.players.every(p => p.piece);
        if (allReady) {
            startMonopolyGame(roomId, room);
        }
    });

    socket.on('rollDice', (data) => {
        const { roomId } = data;
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;

        const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex !== room.currentTurn) {
            socket.emit('error', { message: '不是你的回合' });
            return;
        }

        const player = room.players[playerIndex];
        
        if (player.bankrupt) {
            let nextTurn = (room.currentTurn + 1) % room.players.length;
            let attempts = 0;
            
            while (room.players[nextTurn].bankrupt && attempts < room.players.length) {
                nextTurn = (nextTurn + 1) % room.players.length;
                attempts++;
            }
            
            room.currentTurn = nextTurn;
            io.to(roomId).emit('turnChanged', {
                currentTurn: room.currentTurn,
                currentPlayer: room.players[room.currentTurn].name
            });
            return;
        }
        
        if (player.skipTurn) {
            player.skipTurn = false;
            
            io.to(roomId).emit('turnSkipped', {
                playerName: player.name
            });
            
            let nextTurn = (room.currentTurn + 1) % room.players.length;
            let attempts = 0;
            
            while (room.players[nextTurn].bankrupt && attempts < room.players.length) {
                nextTurn = (nextTurn + 1) % room.players.length;
                attempts++;
            }
            
            room.currentTurn = nextTurn;
            const nextPlayer = room.players[nextTurn];
            
            io.to(roomId).emit('turnChanged', {
                currentTurn: nextTurn,
                currentPlayer: nextPlayer.name
            });

            if (nextPlayer.isRobot && !nextPlayer.bankrupt) {
                setTimeout(() => handleRobotTurn(roomId), 1000);
            }
            return;
        }

        const dice = Math.floor(Math.random() * 6) + 1;
        const oldPosition = player.position;
        player.position = (player.position + dice) % 40;

        const passedStart = oldPosition > player.position && player.position !== 0;
        if (passedStart) {
            player.money += 2000;
        }

        const cell = room.board[player.position];
        let landAction = null;
        let chanceCard = null;

        if (cell.type === 'property') {
            if (cell.owner && cell.owner !== player.name) {
                const owner = room.players.find(p => p.name === cell.owner);
                let rentAmount;
                if (cell.isApartment) {
                    rentAmount = cell.rentApartment;
                } else if (cell.houses === 2) {
                    rentAmount = cell.rent2;
                } else if (cell.houses === 1) {
                    rentAmount = cell.rent1;
                } else {
                    rentAmount = cell.rentBase;
                }
                
                if (player.money >= rentAmount) {
                    player.money -= rentAmount;
                    if (owner) {
                        owner.money += rentAmount;
                    }
                    landAction = { type: 'rent', amount: rentAmount, owner: cell.owner, ownerPiece: owner?.piece };
                } else {
                    const paid = player.money;
                    player.money = 0;
                    if (owner) {
                        owner.money += paid;
                    }
                    
                    const sellableProperties = [];
                    room.board.forEach((c, idx) => {
                        if (c.type === 'property' && c.owner === player.name) {
                            sellableProperties.push({
                                index: idx,
                                name: c.name,
                                price: Math.floor(c.price * 0.6),
                                houses: c.houses,
                                isApartment: c.isApartment,
                                housePrice: Math.floor(c.housePrice * 0.6)
                            });
                        }
                    });
                    
                    if (sellableProperties.length > 0) {
                        player.pendingPayment = rentAmount;
                        player.pendingOwner = cell.owner;
                        player.paidAmount = paid;
                        
                        landAction = { 
                            type: 'cannotAfford', 
                            amount: rentAmount, 
                            paid,
                            owner: cell.owner, 
                            ownerPiece: owner?.piece,
                            sellableProperties 
                        };
                    } else {
                        player.bankrupt = true;
                        
                        room.board.forEach(c => {
                            if (c.owner === player.name) {
                                c.owner = null;
                                c.houses = 0;
                                c.isApartment = false;
                            }
                        });
                        
                        landAction = { type: 'bankrupt', amount: rentAmount };
                    }
                }
            } else if (!cell.owner) {
                landAction = { type: 'canBuy', price: cell.price };
            } else if (cell.owner === player.name && !cell.isApartment) {
                landAction = { type: 'canBuild', houses: cell.houses, housePrice: cell.housePrice };
            }
        } else if (cell.type === 'tax') {
            if (player.money >= cell.price) {
                player.money -= cell.price;
                landAction = { type: 'tax', amount: cell.price };
            } else {
                const paid = player.money;
                player.money = 0;
                
                const sellableProperties = [];
                room.board.forEach((c, idx) => {
                    if (c.type === 'property' && c.owner === player.name) {
                        sellableProperties.push({
                            index: idx,
                            name: c.name,
                            price: Math.floor(c.price * 0.6),
                            houses: c.houses,
                            isApartment: c.isApartment,
                            housePrice: Math.floor(c.housePrice * 0.6)
                        });
                    }
                });
                
                if (sellableProperties.length > 0) {
                    player.pendingPayment = cell.price;
                    player.pendingOwner = null;
                    player.paidAmount = paid;
                    
                    landAction = { 
                        type: 'cannotAfford', 
                        amount: cell.price, 
                        paid,
                        owner: null,
                        sellableProperties 
                    };
                } else {
                    player.bankrupt = true;
                    
                    room.board.forEach(c => {
                        if (c.owner === player.name) {
                            c.owner = null;
                            c.houses = 0;
                            c.isApartment = false;
                        }
                    });
                    
                    landAction = { type: 'bankrupt', amount: cell.price };
                }
            }
        } else if (cell.type === 'jail') {
            player.skipTurn = true;
            landAction = { type: 'jail' };
        } else if (cell.type === 'chance') {
            chanceCard = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
            
            if (chanceCard.money) {
                player.money += chanceCard.money;
            }
            if (chanceCard.steps) {
                const oldPos = player.position;
                player.position = (player.position + chanceCard.steps + 40) % 40;
                
                if (chanceCard.steps > 0 && oldPos > player.position) {
                    player.money += 2000;
                } else if (chanceCard.steps < 0 && oldPos < player.position) {
                    player.money += 2000;
                }
            }
            
            landAction = { type: 'chance', card: chanceCard };
        }

        const finalCell = room.board[player.position];
        if (cell.type === 'chance' && chanceCard && chanceCard.steps) {
            if (finalCell.type === 'property' && finalCell.owner && finalCell.owner !== player.name) {
                const owner = room.players.find(p => p.name === finalCell.owner);
                let rentAmount;
                if (finalCell.isApartment) {
                    rentAmount = finalCell.rentApartment;
                } else if (finalCell.houses === 2) {
                    rentAmount = finalCell.rent2;
                } else if (finalCell.houses === 1) {
                    rentAmount = finalCell.rent1;
                } else {
                    rentAmount = finalCell.rentBase;
                }
                
                if (player.money >= rentAmount) {
                    player.money -= rentAmount;
                    if (owner) owner.money += rentAmount;
                } else {
                    if (owner) owner.money += player.money;
                    player.money = 0;
                }
                landAction = { type: 'chance', card: chanceCard, extraAction: { type: 'rent', amount: rentAmount, owner: finalCell.owner } };
            }
        }

        io.to(roomId).emit('diceRolled', {
            playerName: player.name,
            dice,
            oldPosition,
            newPosition: player.position,
            passedStart,
            landAction,
            chanceCard,
            cell: {
                index: finalCell.index,
                type: finalCell.type,
                name: finalCell.name,
                desc: finalCell.desc,
                price: finalCell.price,
                housePrice: finalCell.housePrice,
                rentBase: finalCell.rentBase,
                rent1: finalCell.rent1,
                rent2: finalCell.rent2,
                rentApartment: finalCell.rentApartment,
                owner: finalCell.owner,
                houses: finalCell.houses,
                isApartment: finalCell.isApartment
            },
            players: room.players.map(p => ({ 
                name: p.name, 
                money: p.money, 
                position: p.position, 
                piece: p.piece 
            })),
            currentTurn: room.currentTurn
        });
    });

    socket.on('buyProperty', (data) => {
        const { roomId, position } = data;
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const cell = room.board[position];
        if (!cell || cell.type !== 'property' || cell.owner) return;

        if (player.money < cell.price) {
            socket.emit('error', { message: '资金不足' });
            return;
        }

        player.money -= cell.price;
        cell.owner = player.name;

        const colorIndex = PIECES.indexOf(player.piece);
        const playerColor = colorIndex >= 0 ? PIECE_COLORS[colorIndex] : '#fff';

        let nextTurn = (room.currentTurn + 1) % room.players.length;
        let attempts = 0;
        while (room.players[nextTurn].bankrupt && attempts < room.players.length) {
            nextTurn = (nextTurn + 1) % room.players.length;
            attempts++;
        }
        room.currentTurn = nextTurn;

        const nextPlayer = room.players[nextTurn];

        io.to(roomId).emit('propertyBought', {
            position,
            owner: player.name,
            ownerPiece: player.piece,
            ownerColor: playerColor,
            players: room.players.map(p => ({ 
                name: p.name, 
                money: p.money,
                piece: p.piece
            })),
            board: room.board.map(c => ({
                index: c.index,
                owner: c.owner,
                houses: c.houses,
                isApartment: c.isApartment
            })),
            currentTurn: room.currentTurn,
            currentPlayer: nextPlayer.name
        });

        if (nextPlayer.isRobot && !nextPlayer.bankrupt) {
            console.log(`buyProperty: 触发机器人 ${nextPlayer.name} 的回合`);
            setTimeout(() => handleRobotTurn(roomId), 1000);
        }
    });

    socket.on('buildHouse', (data) => {
        const { roomId, position } = data;
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const cell = room.board[position];
        if (!cell || cell.type !== 'property' || cell.owner !== player.name) return;
        if (cell.isApartment) return;

        const housePrice = cell.housePrice;
        if (player.money < housePrice) {
            socket.emit('error', { message: '资金不足' });
            return;
        }

        player.money -= housePrice;
        cell.houses++;

        if (cell.houses >= 3) {
            cell.isApartment = true;
            cell.houses = 0;
        }

        let nextTurn = (room.currentTurn + 1) % room.players.length;
        let attempts = 0;
        while (room.players[nextTurn].bankrupt && attempts < room.players.length) {
            nextTurn = (nextTurn + 1) % room.players.length;
            attempts++;
        }
        room.currentTurn = nextTurn;

        const nextPlayer = room.players[nextTurn];

        io.to(roomId).emit('houseBuilt', {
            position,
            houses: cell.houses,
            isApartment: cell.isApartment,
            cellName: cell.name,
            owner: player.name,
            players: room.players.map(p => ({ 
                name: p.name, 
                money: p.money,
                piece: p.piece
            })),
            board: room.board.map(c => ({
                index: c.index,
                owner: c.owner,
                houses: c.houses,
                isApartment: c.isApartment
            })),
            currentTurn: room.currentTurn,
            currentPlayer: nextPlayer.name
        });

        if (nextPlayer.isRobot && !nextPlayer.bankrupt) {
            console.log(`buildHouse: 触发机器人 ${nextPlayer.name} 的回合`);
            setTimeout(() => handleRobotTurn(roomId), 1000);
        }
    });

    socket.on('skipAction', (data) => {
        const { roomId } = data;
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;

        let nextTurn = (room.currentTurn + 1) % room.players.length;
        let attempts = 0;
        
        while (room.players[nextTurn].bankrupt && attempts < room.players.length) {
            nextTurn = (nextTurn + 1) % room.players.length;
            attempts++;
        }
        
        room.currentTurn = nextTurn;
        const nextPlayer = room.players[nextTurn];
        
        io.to(roomId).emit('turnChanged', {
            currentTurn: room.currentTurn,
            currentPlayer: nextPlayer.name
        });

        if (nextPlayer.isRobot && !nextPlayer.bankrupt) {
            console.log(`skipAction: 触发机器人 ${nextPlayer.name} 的回合`);
            setTimeout(() => handleRobotTurn(roomId), 1000);
        }
    });

    socket.on('endTurn', (data) => {
        const { roomId } = data;
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;

        console.log(`endTurn: 当前回合 ${room.currentTurn}, 玩家 ${room.players[room.currentTurn]?.name}`);

        const activePlayers = room.players.filter(p => !p.bankrupt);
        if (activePlayers.length <= 1) {
            const winner = activePlayers[0];
            if (winner) {
                announceMonopolyWinner(roomId, winner.name);
            }
            return;
        }

        let nextTurn = room.currentTurn;
        let attempts = 0;
        
        do {
            nextTurn = (nextTurn + 1) % room.players.length;
            attempts++;
        } while (room.players[nextTurn].bankrupt && attempts < room.players.length);

        const nextPlayer = room.players[nextTurn];
        console.log(`endTurn: 下一个玩家索引 ${nextTurn}, 名字 ${nextPlayer?.name}, isRobot ${nextPlayer?.isRobot}`);
        
        if (nextPlayer.skipTurn) {
            nextPlayer.skipTurn = false;
            
            io.to(roomId).emit('turnSkipped', { 
                playerName: nextPlayer.name
            });
            
            setTimeout(() => {
                const room = monopolyRooms.get(roomId);
                if (!room) return;
                
                let skipNextTurn = (nextTurn + 1) % room.players.length;
                let attempts = 0;
                while (room.players[skipNextTurn].bankrupt && attempts < room.players.length) {
                    skipNextTurn = (skipNextTurn + 1) % room.players.length;
                    attempts++;
                }
                
                room.currentTurn = skipNextTurn;
                const skipNextPlayer = room.players[skipNextTurn];
                
                io.to(roomId).emit('turnChanged', {
                    currentTurn: skipNextTurn,
                    currentPlayer: skipNextPlayer.name
                });
                
                if (skipNextPlayer.isRobot && !skipNextPlayer.bankrupt) {
                    setTimeout(() => handleRobotTurn(roomId), 1000);
                }
            }, 1000);
            return;
        }
        
        room.currentTurn = nextTurn;
        
        io.to(roomId).emit('turnChanged', {
            currentTurn: room.currentTurn,
            currentPlayer: room.players[room.currentTurn].name
        });

        if (nextPlayer.isRobot && !nextPlayer.bankrupt) {
            console.log(`endTurn: 触发机器人 ${nextPlayer.name} 的回合`);
            setTimeout(() => handleRobotTurn(roomId), 1000);
        }
    });

    socket.on('sellProperty', (data) => {
        const { roomId, position } = data;
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player || player.bankrupt) return;

        const cell = room.board[position];
        if (!cell || cell.type !== 'property' || cell.owner !== player.name) return;

        const sellPrice = Math.floor(cell.price * 0.6);
        player.money += sellPrice;
        
        const owner = room.players.find(p => p.name === cell.owner);
        const colorIndex = PIECES.indexOf(owner?.piece);
        const ownerColor = colorIndex >= 0 ? PIECE_COLORS[colorIndex] : '#fff';

        cell.owner = null;
        cell.houses = 0;
        cell.isApartment = false;

        io.to(roomId).emit('propertySold', {
            position,
            seller: player.name,
            sellPrice,
            board: room.board.map(c => ({
                index: c.index,
                owner: c.owner,
                houses: c.houses,
                isApartment: c.isApartment
            }))
        });

        if (player.pendingPayment) {
            const owed = player.pendingPayment - player.paidAmount;
            if (player.money >= owed) {
                player.money -= owed;
                const owner2 = room.players.find(p => p.name === player.pendingOwner);
                if (owner2) {
                    owner2.money += owed;
                }
                
                io.to(roomId).emit('rentPaid', {
                    playerName: player.name,
                    owner: player.pendingOwner,
                    amount: owed,
                    board: room.board.map(c => ({
                        index: c.index,
                        owner: c.owner,
                        houses: c.houses,
                        isApartment: c.isApartment
                    })),
                    players: room.players.map(p => ({
                        name: p.name,
                        money: p.money,
                        position: p.position,
                        piece: p.piece
                    })),
                    currentTurn: room.currentTurn
                });
                
                player.pendingPayment = null;
                player.pendingOwner = null;
                player.paidAmount = 0;
            } else {
                const sellableProperties = [];
                room.board.forEach((c, idx) => {
                    if (c.type === 'property' && c.owner === player.name) {
                        sellableProperties.push({
                            index: idx,
                            name: c.name,
                            price: Math.floor(c.price * 0.6),
                            houses: c.houses,
                            isApartment: c.isApartment,
                            housePrice: Math.floor(c.housePrice * 0.6)
                        });
                    }
                });
                
                if (sellableProperties.length > 0) {
                    io.to(roomId).emit('stillCannotAfford', {
                        amount: player.pendingPayment,
                        paid: player.paidAmount,
                        owner: player.pendingOwner,
                        sellableProperties
                    });
                } else {
                    player.bankrupt = true;
                    
                    room.board.forEach(c => {
                        if (c.owner === player.name) {
                            c.owner = null;
                            c.houses = 0;
                            c.isApartment = false;
                        }
                    });
                    
                    io.to(roomId).emit('playerBankrupt', {
                        playerName: player.name,
                        board: room.board.map(c => ({
                            index: c.index,
                            owner: c.owner,
                            houses: c.houses,
                            isApartment: c.isApartment
                        }))
                    });
                    
                    const activePlayers = room.players.filter(p => !p.bankrupt);
                    if (activePlayers.length === 1) {
                        announceMonopolyWinner(roomId, activePlayers[0].name);
                    }
                }
            }
        }
    });

    socket.on('sellHouse', (data) => {
        const { roomId, position } = data;
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player || player.bankrupt) return;

        const cell = room.board[position];
        if (!cell || cell.type !== 'property' || cell.owner !== player.name) return;

        const sellPrice = Math.floor(cell.housePrice * 0.6);
        player.money += sellPrice;
        
        if (cell.isApartment) {
            cell.houses = 2;
            cell.isApartment = false;
        } else {
            cell.houses--;
        }

        io.to(roomId).emit('houseSold', {
            position,
            seller: player.name,
            sellPrice,
            houses: cell.houses,
            isApartment: cell.isApartment,
            board: room.board.map(c => ({
                index: c.index,
                owner: c.owner,
                houses: c.houses,
                isApartment: c.isApartment
            }))
        });

        if (player.pendingPayment) {
            const owed = player.pendingPayment - player.paidAmount;
            if (player.money >= owed) {
                player.money -= owed;
                const owner = room.players.find(p => p.name === player.pendingOwner);
                if (owner) {
                    owner.money += owed;
                }
                
                io.to(roomId).emit('rentPaid', {
                    playerName: player.name,
                    owner: player.pendingOwner,
                    amount: owed,
                    board: room.board.map(c => ({
                        index: c.index,
                        owner: c.owner,
                        houses: c.houses,
                        isApartment: c.isApartment
                    })),
                    players: room.players.map(p => ({
                        name: p.name,
                        money: p.money,
                        position: p.position,
                        piece: p.piece
                    })),
                    currentTurn: room.currentTurn
                });
                
                player.pendingPayment = null;
                player.pendingOwner = null;
                player.paidAmount = 0;
            } else {
                const sellableProperties = [];
                room.board.forEach((c, idx) => {
                    if (c.type === 'property' && c.owner === player.name) {
                        sellableProperties.push({
                            index: idx,
                            name: c.name,
                            price: Math.floor(c.price * 0.6),
                            houses: c.houses,
                            isApartment: c.isApartment,
                            housePrice: Math.floor(c.housePrice * 0.6)
                        });
                    }
                });
                
                if (sellableProperties.length > 0) {
                    io.to(roomId).emit('stillCannotAfford', {
                        amount: player.pendingPayment,
                        paid: player.paidAmount,
                        owner: player.pendingOwner,
                        sellableProperties
                    });
                } else {
                    player.bankrupt = true;
                    
                    room.board.forEach(c => {
                        if (c.owner === player.name) {
                            c.owner = null;
                            c.houses = 0;
                            c.isApartment = false;
                        }
                    });
                    
                    io.to(roomId).emit('playerBankrupt', {
                        playerName: player.name,
                        board: room.board.map(c => ({
                            index: c.index,
                            owner: c.owner,
                            houses: c.houses,
                            isApartment: c.isApartment
                        }))
                    });
                    
                    const activePlayers = room.players.filter(p => !p.bankrupt);
                    if (activePlayers.length === 1) {
                        announceMonopolyWinner(roomId, activePlayers[0].name);
                    }
                }
            }
        }
    });

    socket.on('confirmBankrupt', (data) => {
        const { roomId } = data;
        const room = monopolyRooms.get(roomId);
        if (!room || !room.started) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;

        player.bankrupt = true;
        
        room.board.forEach(cell => {
            if (cell.owner === player.name) {
                cell.owner = null;
                cell.houses = 0;
                cell.isApartment = false;
            }
        });

        io.to(roomId).emit('playerBankrupt', {
            playerName: player.name,
            board: room.board.map(c => ({
                index: c.index,
                owner: c.owner,
                houses: c.houses,
                isApartment: c.isApartment
            }))
        });

        const activePlayers = room.players.filter(p => !p.bankrupt);
        if (activePlayers.length === 1) {
            announceMonopolyWinner(roomId, activePlayers[0].name);
        }
    });

    socket.on('leaveMonopolyRoom', (data) => {
        const { roomId } = data;
        handleMonopolyPlayerExit(roomId, socket.id, 'exit');
        socket.leave(roomId);
    });
});

const PORT = process.env.PORT || 3000;
const os = require('os');

function generateMonopolyBoard() {
    const countryData = [
        { name: '中国', desc: '东方古国，五千年的文明历史，长城故宫举世闻名。', price: 1500, housePrice: 750, rentBase: 50, rent1: 1000, rent2: 2000, rentApartment: 3500 },
        { name: '日本', desc: '樱花之国，科技发达，传统与现代完美融合。', price: 1600, housePrice: 800, rentBase: 60, rent1: 1200, rent2: 2400, rentApartment: 4200 },
        { name: '韩国', desc: '韩流文化的发源地，时尚与美食的天堂。', price: 1200, housePrice: 600, rentBase: 40, rent1: 800, rent2: 1600, rentApartment: 2800 },
        { name: '泰国', desc: '微笑之国，大象的故乡，热带风情浓郁。', price: 1000, housePrice: 500, rentBase: 35, rent1: 700, rent2: 1400, rentApartment: 2500 },
        { name: '越南', desc: '东南亚明珠，风景秀丽，物产丰富。', price: 900, housePrice: 450, rentBase: 30, rent1: 600, rent2: 1200, rentApartment: 2100 },
        { name: '新加坡', desc: '狮城，亚洲金融中心，花园城市。', price: 1800, housePrice: 900, rentBase: 70, rent1: 1400, rent2: 2800, rentApartment: 4900 },
        { name: '马来西亚', desc: '热带雨林之国，多元文化交汇之地。', price: 1100, housePrice: 550, rentBase: 38, rent1: 760, rent2: 1520, rentApartment: 2700 },
        { name: '印度尼西亚', desc: '万岛之国，巴厘岛的浪漫令人向往。', price: 1000, housePrice: 500, rentBase: 32, rent1: 640, rent2: 1280, rentApartment: 2200 },
        { name: '印度', desc: '神秘古国，泰姬陵的爱情故事流传千古。', price: 1300, housePrice: 650, rentBase: 45, rent1: 900, rent2: 1800, rentApartment: 3200 },
        { name: '阿联酋', desc: '沙漠中的奇迹，迪拜塔直插云霄。', price: 2200, housePrice: 1100, rentBase: 85, rent1: 1700, rent2: 3400, rentApartment: 6000 },
        { name: '土耳其', desc: '欧亚交汇，历史的十字路口。', price: 1400, housePrice: 700, rentBase: 48, rent1: 960, rent2: 1920, rentApartment: 3400 },
        { name: '俄罗斯', desc: '冰雪之国，广袤的土地蕴藏无限资源。', price: 1700, housePrice: 850, rentBase: 60, rent1: 1200, rent2: 2400, rentApartment: 4200 },
        { name: '德国', desc: '工业强国，严谨与创新并存的国度。', price: 1900, housePrice: 950, rentBase: 72, rent1: 1440, rent2: 2880, rentApartment: 5000 },
        { name: '法国', desc: '浪漫之都，埃菲尔铁塔的灯光璀璨。', price: 2000, housePrice: 1000, rentBase: 75, rent1: 1500, rent2: 3000, rentApartment: 5200 },
        { name: '英国', desc: '日不落帝国，伦敦眼见证历史变迁。', price: 2100, housePrice: 1050, rentBase: 78, rent1: 1560, rent2: 3120, rentApartment: 5500 },
        { name: '意大利', desc: '艺术之国，罗马斗兽场诉说着辉煌。', price: 1850, housePrice: 925, rentBase: 68, rent1: 1360, rent2: 2720, rentApartment: 4800 },
        { name: '西班牙', desc: '热情似火，弗拉明戈舞动人心。', price: 1500, housePrice: 750, rentBase: 55, rent1: 1100, rent2: 2200, rentApartment: 3800 },
        { name: '荷兰', desc: '风车与郁金香的王国，田园诗画。', price: 1650, housePrice: 825, rentBase: 62, rent1: 1240, rent2: 2480, rentApartment: 4300 },
        { name: '瑞士', desc: '阿尔卑斯山下，钟表与银行闻名世界。', price: 2300, housePrice: 1150, rentBase: 90, rent1: 1800, rent2: 3600, rentApartment: 6300 },
        { name: '奥地利', desc: '音乐之国，莫扎特的故乡。', price: 1550, housePrice: 775, rentBase: 58, rent1: 1160, rent2: 2320, rentApartment: 4000 },
        { name: '瑞典', desc: '北欧童话，维京的后裔。', price: 1450, housePrice: 725, rentBase: 52, rent1: 1040, rent2: 2080, rentApartment: 3600 },
        { name: '挪威', desc: '峡湾之国，极光的绚丽令人陶醉。', price: 1600, housePrice: 800, rentBase: 58, rent1: 1160, rent2: 2320, rentApartment: 4100 },
        { name: '丹麦', desc: '童话王国，小美人鱼的故乡。', price: 1400, housePrice: 700, rentBase: 50, rent1: 1000, rent2: 2000, rentApartment: 3500 },
        { name: '芬兰', desc: '圣诞老人的家，森林与湖泊的国度。', price: 1350, housePrice: 675, rentBase: 48, rent1: 960, rent2: 1920, rentApartment: 3300 },
        { name: '美国', desc: '自由女神像指引梦想之地。', price: 2500, housePrice: 1250, rentBase: 100, rent1: 2000, rent2: 4000, rentApartment: 7000 },
        { name: '加拿大', desc: '枫叶之国，自然风光壮美。', price: 1800, housePrice: 900, rentBase: 68, rent1: 1360, rent2: 2720, rentApartment: 4700 },
        { name: '墨西哥', desc: '玛雅文明的传承，热情奔放。', price: 950, housePrice: 475, rentBase: 32, rent1: 640, rent2: 1280, rentApartment: 2200 },
        { name: '巴西', desc: '足球王国，桑巴舞的热情四溢。', price: 1300, housePrice: 650, rentBase: 45, rent1: 900, rent2: 1800, rentApartment: 3100 },
        { name: '阿根廷', desc: '探戈的发源地，烤肉香气飘香。', price: 1150, housePrice: 575, rentBase: 40, rent1: 800, rent2: 1600, rentApartment: 2800 },
        { name: '智利', desc: '狭长的国度，葡萄美酒享誉全球。', price: 1050, housePrice: 525, rentBase: 36, rent1: 720, rent2: 1440, rentApartment: 2500 },
        { name: '澳大利亚', desc: '袋鼠的故乡，大堡礁的奇观。', price: 1750, housePrice: 875, rentBase: 65, rent1: 1300, rent2: 2600, rentApartment: 4500 },
        { name: '新西兰', desc: '中土世界，纯净的自然天堂。', price: 1600, housePrice: 800, rentBase: 58, rent1: 1160, rent2: 2320, rentApartment: 4100 },
        { name: '埃及', desc: '金字塔的神秘，法老的传说。', price: 800, housePrice: 400, rentBase: 28, rent1: 560, rent2: 1120, rentApartment: 1900 },
        { name: '南非', desc: '钻石之国，野生动物的王国。', price: 1100, housePrice: 550, rentBase: 38, rent1: 760, rent2: 1520, rentApartment: 2700 },
        { name: '肯尼亚', desc: '动物大迁徙的壮观场面。', price: 750, housePrice: 375, rentBase: 25, rent1: 500, rent2: 1000, rentApartment: 1700 },
        { name: '摩洛哥', desc: '撒哈拉的入口，蓝色的童话小镇。', price: 850, housePrice: 425, rentBase: 28, rent1: 560, rent2: 1120, rentApartment: 2000 },
        { name: '希腊', desc: '西方文明的摇篮，奥林匹克的起源。', price: 1450, housePrice: 725, rentBase: 52, rent1: 1040, rent2: 2080, rentApartment: 3600 },
        { name: '葡萄牙', desc: '大航海时代的先驱，足球的狂热。', price: 1250, housePrice: 625, rentBase: 42, rent1: 840, rent2: 1680, rentApartment: 2900 },
        { name: '爱尔兰', desc: '翡翠岛国，啤酒与三叶草。', price: 1350, housePrice: 675, rentBase: 48, rent1: 960, rent2: 1920, rentApartment: 3300 },
        { name: '比利时', desc: '巧克力王国，啤酒花飘香。', price: 1400, housePrice: 700, rentBase: 50, rent1: 1000, rent2: 2000, rentApartment: 3500 }
    ];
    
    const board = [];
    let countryIndex = 0;
    
    for (let i = 0; i < 40; i++) {
        let type, name, price, rent, desc, housePrice, rentBase, rent1, rent2, rentApartment;
        
        if (i === 0) {
            type = 'start';
            name = '起点';
            desc = '经过此处可获得$2000奖励';
        } else if (i === 10) {
            type = 'parking';
            name = '监狱';
            desc = '路过监狱，安全无虞';
        } else if (i === 20) {
            type = 'parking';
            name = '免费停车';
            desc = '在此休息，不收任何费用';
        } else if (i === 30) {
            type = 'jail';
            name = '入狱';
            desc = '落入监狱！下一回合跳过';
        } else if (i === 7 || i === 18 || i === 28 || i === 37) {
            type = 'chance';
            name = '机会';
            desc = '抽取机会卡，惊喜或惊吓';
        } else if (i === 5 || i === 15 || i === 25 || i === 35) {
            type = 'tax';
            name = '税收';
            price = 500 + Math.floor(i / 10) * 200;
            desc = `缴纳税款 $${price}`;
        } else {
            type = 'property';
            const country = countryData[countryIndex++];
            name = country.name;
            desc = country.desc;
            price = country.price;
            housePrice = country.housePrice;
            rentBase = country.rentBase;
            rent1 = country.rent1;
            rent2 = country.rent2;
            rentApartment = country.rentApartment;
            rent = country.rentBase;
        }
        
        board.push({ 
            index: i, 
            type, 
            name, 
            price, 
            rent,
            housePrice,
            rentBase,
            rent1,
            rent2,
            rentApartment,
            desc,
            owner: null,
            houses: 0,
            isApartment: false
        });
    }
    
    return board;
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    serverIP = localIP;
    console.log('=================================');
    console.log('   局域网聊天服务器已启动!');
    console.log('=================================');
    console.log(`本机访问: http://localhost:${PORT}`);
    console.log(`局域网访问: http://${localIP}:${PORT}`);
    console.log('=================================');
    console.log('其他设备请在浏览器中输入局域网地址');
});
