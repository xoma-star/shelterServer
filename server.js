import {WebSocketServer} from "ws";
import {distresses, genders, health, hobby, sex, shelterLocations, shelterNames} from "./meta.js";

class Server {
    constructor() {
        let port = process.env.PORT || 5500
        this.server = new WebSocketServer({port: port})
        this.clients = {}
        this.server.on('connection', ws => {
            let clientId = this.generateRoomNumber()
            this.clients[clientId] = ws
            this.clients[clientId].id = clientId
            this.clients[clientId].roomId = -1
            this.clients[clientId].send(JSON.stringify({
                type: 'connected',
                data: {
                    id: clientId
                }
            }))
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
            let client = this.clients[id]
            if(client.roomId >= 0) this.disconnectRoom({userId: client.id, roomId: client.roomId})
            delete this.clients[id]
        })
    }
    messageHandler(id){
        this.clients[id].on('message', m => {
            let message = JSON.parse(m)
            if(message.type === 'createRoom') this.createRoom(message.data)
            if(message.type === 'connectRoom') this.connectRoom(message.data)
            if(message.type === 'disconnectRoom') this.disconnectRoom(message.data)
            if(message.type === 'startRoom') this.startRoom(message.data)
        })
    }
    startRoom(data){
        let room = Object.assign({}, this.rooms.find(x => x.id === data.roomId))
        room.willSurvive = Math.floor(room.players.length * room.willSurvivePercents / 100)
        room.distress = this.getRandomFromArray(distresses)
        room.shelterName = this.getRandomFromArray(shelterNames)
        room.shelterLocation = this.getRandomFromArray(shelterLocations)
        room.currentTurn = 0
        for(let i = 0; i < room.players.length; i++){
            room.players[i].stats = {
                biologic: `${this.getRandomFromArray(sex)}, ${this.getRandomFromArray(genders)}, ${this.generateRandom(18, 100)} лет`,
                health: this.getRandomFromArray(health),
                hobby: this.getRandomFromArray(hobby)
            }
            room.players[i].revealed = []
            room.players[i].abilities = []
        }
        this.broadcast(room.id, {type: 'roomStarted', data: room})
        this.getClient(room.players[0].id).send(JSON.stringify({type: 'newTurn'}))
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
        let userIndex = this.rooms[roomIndex].players.findIndex(x => x.id === id)
        if(roomIndex >= 0 && userIndex >= 0) this.rooms[roomIndex].players.splice(userIndex, 1)
        if(this.rooms[roomIndex].players.length === 0) this.rooms.splice(roomIndex, 1)
        else this.broadcast(roomId, {type: 'roomDataUpdated', data: this.rooms[roomIndex]}, id)
        this.clients[id].roomId = -1
    }
    pushRoom(room){
        this.rooms.push(room)
    }
    createRoom(data){
        let client = this.getClient(data.userData.id)
        client.roomId = this.generateRoomNumber()
        let room = this.generateRoom(data)
        this.pushRoom(room)
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
                v.send(JSON.stringify(sendInfo), {binary: false})
            }
        })
    }
    generateRoom(data){
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