# WebSocket Chat Documentation

Real-time chat system using Socket.IO for private 1:1 and group messaging.

---

## Table of Contents

1. [Connection and Handshake](#1-connection-and-handshake)
2. [Connection Lifecycle](#2-connection-lifecycle)
3. [Client Events (Emit)](#3-client-events-emit)
4. [Server Events (Listen)](#4-server-events-listen)
5. [Error Codes](#5-error-codes)
6. [Rate Limits](#6-rate-limits)
7. [Payload Specifications](#7-payload-specifications)

---

## 1. Connection and Handshake

### URL
```
ws://localhost:5000 (local)
wss://api.domain.com (production)
```

### Connection Setup

Pass JWT token in handshake auth:
```typescript
const socket = io(URL, {
  auth: { authorization: 'Bearer YOUR_JWT_TOKEN' }
});
```

### After Connection

Listen for `connected` event to confirm success:
```typescript
socket.on('connected', (data) => {
  // { user: { _id, firstName, lastName } }
});
```

### Connection Errors

If auth fails, you'll get error before `connected`:
- Missing token → `"Authentication token is required"`
- Invalid format → `"Invalid authentication token format"`
- Expired token → `"Invalid or expired authentication token"`
- Too many attempts → `"Too many socket connection attempts, please try again later"`

---

## 2. Connection Lifecycle

| Event | When | What to Do |
|-------|------|-----------|
| `connected` | After successful auth | Save user info, UI ready |
| `disconnect` | Connection lost | Hide real-time features, show offline |
| `reconnect` | Auto-reconnect succeeded | Refresh data |
| `error` | Any error | Show error to user |

```typescript
socket.on('connected', (data) => {
  // Ready to chat
});

socket.on('disconnect', () => {
  // Waiting for reconnect (auto)
});

socket.on('error', (error) => {
  // { message: 'error message' }
});
```

---

## 3. Client Events (Emit)

### Send Private Message

**Emit event:**
```typescript
socket.emit('send-private-message', {
  text: 'Your message',
  targetUserId: 'recipient_id'
});
```

**Listen for response:**
```typescript
socket.on('message-sent', (message) => {
  // Message received by all in conversation
});
```

**Rules:**
- Text: 1-2000 characters
- targetUserId: Valid user ObjectId
- Rate limit: 60 per minute

---

### Get Private Chat History

**Emit event:**
```typescript
socket.emit('get-chat-history', 'other_user_id');
```

**Listen for response:**
```typescript
socket.on('chat-history', (messages) => {
  // Array of messages
});
```

**Rules:**
- Auto-joins conversation room
- Auto-creates conversation if doesn't exist
- Rate limit: 30 per minute

---

### Send Group Message

**Emit event:**
```typescript
socket.emit('send-group-message', {
  text: 'Your message',
  targetGroupId: 'group_id'
});
```

**Listen for response:**
```typescript
socket.on('message-sent', (message) => {
  // Message received by all group members
});
```

**Rules:**
- Text: 1-2000 characters
- targetGroupId: Valid group ObjectId
- Must be group member
- Rate limit: 60 per minute

---

### Get Group Chat History

**Emit event:**
```typescript
socket.emit('get-group-chat', 'group_id');
```

**Listen for response:**
```typescript
socket.on('group-chat-history', (messages) => {
  // Array of group messages
});
```

**Rules:**
- Auto-joins group room
- Must be group member
- Rate limit: 30 per minute

---

## 4. Server Events (Listen)

### message-sent

Broadcast to all users in the conversation/group room.

```typescript
socket.on('message-sent', (message) => {
  // { _id, text, conversationId, senderId, createdAt }
  // Add to UI message list
});
```

Emitted after:
- `send-private-message` processed
- `send-group-message` processed

---

### chat-history

Direct response to `get-chat-history` (only to requester).

```typescript
socket.on('chat-history', (messages) => {
  // Array of message objects
  // Load into UI
});
```

---

### group-chat-history

Direct response to `get-group-chat` (only to requester).

```typescript
socket.on('group-chat-history', (messages) => {
  // Array of message objects
  // Load into UI
});
```

---

### error

Emitted on any error.

```typescript
socket.on('error', (error) => {
  // { message: 'error description' }
  // Show to user
});
```

---

## 5. Error Codes

All errors emit to `error` event with message string.

| Error Message | Cause | Action |
|---------------|-------|--------|
| `Authentication token is required` | Missing JWT | Pass token in auth |
| `Invalid authentication token format` | Wrong format | Use "Bearer TOKEN" |
| `Invalid or expired authentication token` | Token expired/invalid | Refresh token |
| `Invalid authentication token payload` | Bad token claim | Re-login |
| `Too many socket connection attempts, please try again later` | >20 attempts in 5m | Wait 5 mins |
| `Too many messages, please slow down.` | >60 msgs/min | Throttle sending |
| `Too many chat history requests, please slow down.` | >30 requests/min | Wait before fetching |
| `Invalid socket event payload` | Bad payload format | Check payload schema |
| `You cannot start a direct chat with yourself` | Self-message attempt | Send to different user |
| `Group not found or you are not a member` | Not member or no group | Verify group exists/membership |
| `Socket event failed` | Server error | Retry or check server logs |

---

## 6. Rate Limits

All limits reset every minute.

| Event | Limit | Duration |
|-------|-------|----------|
| Socket connections | 20 | 5 minutes |
| `send-private-message` | 60 | 1 minute |
| `send-group-message` | 60 | 1 minute |
| `get-chat-history` | 30 | 1 minute |
| `get-group-chat` | 30 | 1 minute |

Hitting limit triggers `error` event: "Too many messages, please slow down."

---

## 7. Payload Specifications

**Message:**
```typescript
{ _id, text, conversationId, senderId, createdAt }
```

**Validation:**
- `text`: 1-2000 characters, required
- `targetUserId`, `targetGroupId`: Valid MongoDB ObjectId
- Private chats auto-create; group requires membership

---

## 8. Room Management

**Private Chats:** Auto-join room using conversationId when calling `get-chat-history`. Auto-creates conversation if needed.

**Group Chats:** Join room using groupId when calling `get-group-chat`. Requires group membership.

**Multi-Tab:** Each tab gets separate socket connection but receives same room messages. Closing one tab doesn't affect others.

**Broadcasting:** All users in a room receive `message-sent` events broadcast by any room member.

