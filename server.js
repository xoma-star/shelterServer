import {WebSocketServer} from "ws";
import {
    additional, cards,
    character,
    distresses, equipment,
    genders,
    health,
    hobby,
    phobia, professions, roomConditions,
    sex,
    shelterLocations,
    shelterNames, shelterResources, shelterRooms, shelterRoomsIcons
} from "./meta.js";

class Server {
    constructor() {
        let port = process.env.PORT || 5500
        this.server = new WebSocketServer({port: port})
        this.clients = {}
        this.server.on('connection', (ws, req) => {
            let clientId
            console.log(req.url)
            let url = new URL('wss://shelter-heroku.com'+req.url)
            if(url.searchParams?.get('type') === 'reconnect') clientId = Number(url.searchParams.get('userId'))
            else clientId = this.generateRoomNumber()
            this.clients[clientId] = ws
            this.clients[clientId].id = clientId
            if(url.searchParams?.get('type') !== 'reconnect') this.clients[clientId].roomId = -1
            else this.clients[clientId].roomId = Number(url.searchParams?.get('roomId'))
            this.clients[clientId].send(JSON.stringify({
                type: 'connected',
                data: {
                    id: clientId
                }
            }))
            if(url.searchParams?.get('type') === 'reconnect'){
                if(this.clients[clientId].roomId > 0){
                    let room = Object.assign({}, this.rooms.find(x => x.id === this.clients[clientId].roomId))
                    if(room.players.findIndex(x => x.id === clientId) === room.currentTurn) this.clients[clientId].send(JSON.stringify({
                        type: 'newTurn'
                    }))
                }
            }
            this.messageHandler(clientId)
            this.disconnectHandler(clientId)
        })
        this.rooms = []
    }
    getClient(id){
        return this.clients[id]
    }
    disconnectHandler(id){
        this.getClient(id).on('close', () => {
            //let client = this.clients[id]
            //if(client.roomId >= 0) this.disconnectRoom({userId: client.id, roomId: client.roomId})
            delete this.clients[id]
        })
    }
    messageHandler(id){
        this.clients[id].on('message', m => {
            let message = JSON.parse(m)
            console.log('new message: ', id, message)
            if(message.type === 'createRoom') this.createRoom(message.data)
            if(message.type === 'connectRoom') this.connectRoom(message.data)
            if(message.type === 'disconnectRoom') this.disconnectRoom(message.data)
            if(message.type === 'startRoom') this.startRoom(message.data)
            if(message.type === 'didTurn') this.turnHandler(message.data)
            if(message.type === 'newTurn') this.newTurn(message.data)
            if(message.type === 'kickPlayer') this.kickPlayer(message.data)
            if(message.type === 'deleteRoom') this.deleteRoom(message.data)
            if(message.type === 'startConfirm') this.startConfirm(message.data)
            if(message.type === 'useCard') this.useCard(message.data)
            if(message.ping === 'pong') this.clients[id].send(JSON.stringify({pong: 'ping'}))
        })
    }
    useCard(data){
        let room = Object.assign({}, this.rooms.find(x => x.id === data.roomId))
        let card = room.players[data.playerId].cards[data.cardId]
        switch (card.type){
            case 'reveal':
                try{
                    room.players[data.inputVal].revealed.push(card.data.reveal)
                }
                catch (e){}
                break
            case 'swap':
                try {
                    let a = room.players[data.inputVal].stats[card.data.swap] + ""
                    room.players[data.inputVal].stats[card.data.swap] = room.players[data.playerId].stats[card.data.swap] + ""
                    room.players[data.playerId].stats[card.data.swap] = a
                }catch (e) {}
                break
            case 'destroy':
                room.players[data.inputVal].stats[card.data.destroy] = 'уничтожено'
                break
            case 'knowledge':
                switch (card.data.knowledge) {
                    case 'bunker+1place':
                        room.willSurvive++
                        break
                    case 'bunker-1place':
                        room.willSurvive--
                        break
                }
                break
        }
        room.players[data.playerId].cards[data.cardId].used = true
        this.rooms[this.rooms.findIndex(x => x.id === data.roomId)] = room
        this.broadcast(data.roomId, {type: 'roomDataUpdated', data: room})
    }
    startConfirm(data){
        let room = Object.assign({}, this.rooms.find(x => x.id === data.roomId))
        this.getClient(room.players[0].id).send(JSON.stringify({type: 'newTurn'}))
    }
    deleteRoom(data){
        this.broadcast(data.roomId, {type: 'deleteRoom'})
        this.rooms.splice(this.rooms.findIndex(x => x.id === data.roomId), 1)
    }
    kickPlayer(data){
        let room = Object.assign({}, this.rooms.find(x => x.id === data.roomId))
        room.players[data.playerId].kicked = true
        let d = room.players.filter(v => v.kicked === false)
        if(d.length <= room.willSurvive){
            this.broadcast(room.id, {type: 'gameEnded', data: {survived: d}})
            return
        }
        this.rooms[this.rooms.findIndex(x => x.id === data.roomId)] = room
        this.broadcast(data.roomId, {type: 'roomDataUpdated', data: room})
    }
    newTurn(data){
        let room = Object.assign({}, this.rooms.find(x => x.id === data.roomId))
        this.broadcast(room.id, {type: 'didBriefing'})
        this.getClient(room.players[0].id).send(JSON.stringify({type: 'newTurn'}))
    }
    turnHandler(data){
        let room = Object.assign({}, this.rooms.find(x => x.id === data.roomId))
        room.players[room.currentTurn].revealed.push(data.revealed)
        while(true){
            room.currentTurn++
            if(room.currentTurn >= room.players.length){
                break
            }
            if(!room.players[room.currentTurn].kicked) break
        }
        if(room.currentTurn >= room.players.length){
            setTimeout(() => this.broadcast(room.id, {type: 'turnEnded'}), 0)
            room.currentTurn = 0
        }
        else{
            setTimeout(() => this.clients[room.players[room.currentTurn].id].send(JSON.stringify({type: 'newTurn'})), 0)
        }
        this.rooms[this.rooms.findIndex(x => x.id === data.roomId)] = room
        this.broadcast(data.roomId, {type: 'roomDataUpdated', data: room})
    }
    startRoom(data){
        let room = Object.assign({}, this.rooms.find(x => x.id === data.roomId))
        room.willSurvive = Math.floor(room.players.length * room.willSurvivePercents / 100)
        room.distress = this.getRandomFromArray(distresses)
        room.shelterName = this.getRandomFromArray(shelterNames)
        room.shelterLocation = this.getRandomFromArray(shelterLocations)
        room.foods = this.getRandomFromArray(shelterResources)
        room.duration = this.generateRandom(3,36)
        room.rooms = []
        for(let i = 0; i < this.generateRandom(4, shelterRooms.length - 1); i++) {
            let a
            while(true){
                a = this.generateRandom(0, shelterRooms.length)
                if(room.rooms.findIndex(x => x.name === shelterRooms[a]) < 0){
                    room.rooms.push({name: shelterRooms[a], condition: this.getRandomFromArray(roomConditions), icon: shelterRoomsIcons[a]})
                    break
                }
            }
        }
        room.waitingForPlayers = false
        room.currentTurn = 0
        for(let i = 0; i < room.players.length; i++){
            room.players[i].stats = {
                profession: this.getRandomFromArray(professions),
                biologic: `${this.getRandomFromArray(sex)}, ${this.getRandomFromArray(genders)}, ${this.generateRandom(18, 100)} лет`,
                health: this.getRandomFromArray(health),
                hobby: this.getRandomFromArray(hobby),
                character: this.getRandomFromArray(character),
                phobia: this.getRandomFromArray(phobia),
                additional: this.getRandomFromArray(additional),
                equipment: this.getRandomFromArray(equipment)
            }
            room.players[i].kicked = false
            room.players[i].revealed = []
            room.players[i].abilities = []
            room.players[i].cards = []
            while(true){
                if(room.players[i].cards.length >= 2){
                    break
                }
                let a = this.getRandomFromArray(cards)
                a.used = false
                if(room.players[i].cards.findIndex(x => x.data.description === a.data.description) < 0) room.players[i].cards.push(a)
            }
        }
        this.rooms[this.rooms.findIndex(x => x.id === data.roomId)] = room
        console.log('room started', room)
        this.broadcast(room.id, {type: 'roomStarted', data: room})
    }
    disconnectRoom(data){
        this.deletePlayerFromRoom(data.userId, data.roomId)
    }
    getRandomFromArray(array){
        let a = this.generateRandom(0, array.length)
        return array[a]
    }
    deletePlayerFromRoom(id, roomId){
        let roomIndex = this.rooms.findIndex(x => x.id === roomId)
        let userIndex = this.rooms[roomIndex]?.players?.findIndex(x => x.id === id)
        if(roomIndex >= 0 && userIndex >= 0) this.rooms[roomIndex]?.players?.splice(userIndex, 1)
        if(typeof this.rooms[roomIndex] !== 'undefined'){
            if(this.rooms[roomIndex]?.players?.length === 0) this.rooms.splice(roomIndex, 1)
            else this.broadcast(roomId, {type: 'roomDataUpdated', data: this.rooms[roomIndex]}, id)
        }
        this.clients[id].roomId = -1
    }
    pushRoom(room){
        this.rooms.push(room)
    }
    createRoom(data){
        let client = this.getClient(data.userData.id)
        let room
        if(!data.roomData) {
            client.roomId = this.generateRoomNumber()
            room = this.generateRoom(data)
            this.pushRoom(room)
        }else{
            room = this.rooms.find(x => x.id === data.roomData.id)
        }
        client.send(JSON.stringify({
            type: 'createdRoom',
            data: room
        }), {binary: false})
    }
    connectRoom(data){
        let client = this.getClient(data.userData.id)
        let room = this.rooms.find(v => v.id === data.roomId)
        if(typeof room === 'undefined'){
            client.send(JSON.stringify({type: 'error', data: 'Комната с указанным номером не найдена'}))
            return
        }
        client.roomId = data.roomId
        let roomIndex = this.rooms.findIndex(v => v.id === data.roomId)
        let newRoom = Object.assign({}, room)
        let userData = Object.assign({}, data.userData)
        delete userData.roomId
        newRoom.players.push(userData)
        this.updateRoom(roomIndex, newRoom)
        this.broadcast(client.roomId, {
            type: 'roomDataUpdated',
            data: newRoom
        })
    }
    updateRoom(index, room){
        this.rooms[index] = room
    }
    broadcast(roomId, sendInfo, exception = -1){
        this.server.clients.forEach(v => {
            if(v.roomId === roomId && v.id !== exception){
                console.log('sent data to '+v.id, sendInfo)
                v.send(JSON.stringify(sendInfo), {binary: false})
            }
        })
    }
    generateRoom(data, rewrite = false){
        if(rewrite) console.log('a')
        let client = this.getClient(data.userData.id)
        return {
            id: client.roomId,
            players: [data.userData],
            host: data.userData.id,
            eventsEnabled: data.events,
            willSurvive: undefined,
            willSurvivePercents: data.willSurvive,
            seed: data.seed,
            waitingForPlayers: true
        }
    }
    generateRoomNumber(){
        let num = 0
        for (let i = 0; i < 5; i++){
            num += this.generateRandom(0, 10) * Math.pow(10, i)
        }
        return Math.floor(num)
    }
    generateRandom(min, max){
        return Math.floor(Math.random() * (max - min) + min)
    }
}

new Server()

// const removeFromRooms = (message, ws) => {d
//     let roomIndex = rooms.findIndex(v => v.id === message.data.roomId)
//     let players = rooms[roomIndex].players
//     let i = players.findIndex(v => v.id === message.data.userId)
//     players.splice(i, 1)
//     if(players.length === 0) rooms.splice(roomIndex, 1)
//     else rooms[roomIndex].host = rooms[roomIndex].players[0].id
//     ws.roomId = 0
//     server.clients.forEach(v => {
//         if(v.roomId === message.data.roomId){
//             v.send(JSON.stringify({
//                 type: 'roomDataUpdate',
//                 data: rooms[roomIndex]
//             }), {binary: false})
//         }
//     })
// }
//
// const server = new WebSocketServer({port: 5000})
//
// let rooms = []
//
// server.on('connection', ws => {
//     ws.on('message', msg => {
//         let message = JSON.parse(msg)
//         if(message.type === 'createRoom'){
//             ws.roomId = generateRoomNumber()
//             ws.id = message.data.userData.id
//             let room = {
//                 id: ws.roomId,
//                 players: [message.data.userData],
//                 host: message.data.userData.id,
//                 eventsEnabled: message.data.events,
//                 willSurvive: undefined,
//                 willSurvivePercents: message.data.willSurvive,
//                 seed: message.data.seed,
//                 waitingForPlayers: true
//             }
//             rooms.push(room)
//             ws.send(JSON.stringify({
//                 type: 'createdRoom',
//                 data: room
//             }), {binary: false})
//         }
//         if(message.type === 'connectRoom'){
//             let room = rooms.find(v => v.id === message.data.roomId)
//             if(typeof room === 'undefined'){
//                 ws.send(JSON.stringify({type: 'error', data: 'Комната с указанным номером не найдена'}))
//                 return
//             }
//             ws.roomId = message.data.roomId
//             ws.id = message.data.id
//             let roomIndex = rooms.findIndex(v => v.id === message.data.roomId)
//             let newRoom = Object.assign({}, room)
//             let userData = Object.assign({}, message.data)
//             delete userData.roomId
//             newRoom.players.push(userData)
//             rooms[roomIndex] = newRoom
//             server.clients.forEach(v => {
//                 if(v.roomId === ws.roomId){
//                     v.send(JSON.stringify({
//                         // type: 'playerConnected',
//                         type: 'roomDataUpdate',
//                         data: newRoom
//                     }), {binary: false})
//                 }
//             })
//             // ws.send(JSON.stringify({type: 'roomDataUpdate', data: room}))
//         }
//         if(message.type === 'leaveRoom'){
//             removeFromRooms(message, ws)
//         }
//         if(message.type === 'start'){
//
//         }
//     })
//     ws.on('close', () => {
//         removeFromRooms({
//             data: {
//                 roomId: ws.roomId,
//                 userId: ws.id
//             }
//         }, ws)
//     })
// })