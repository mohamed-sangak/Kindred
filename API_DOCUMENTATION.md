# API Documentation

Frontend/client contract for the backend.

## Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [Response Shape](#response-shape)
- [REST Endpoints](#rest-endpoints)
- [Uploads](#uploads)
- [GraphQL](#graphql)
- [Socket.IO](#socketio)
- [Rate Limits](#rate-limits)

## Base URL

| Environment | URL |
| --- | --- |
| Local | `http://localhost:5000` |
| Production | `https://your-api-domain.com` |

## Authentication

REST and GraphQL protected requests:

```txt
Authorization: Bearer <accessToken>
```

Refresh token endpoint:

```txt
Authorization: Bearer <refreshToken>
```

Socket.IO:

```ts
io(API_URL, {
  auth: {
    authorization: 'Bearer <accessToken>',
  },
})
```

## Response Shape

Success:

```json
{
  "meta": {
    "status": 200,
    "success": true,
    "message": "Request processed successfully"
  },
  "data": {}
}
```

Error:

```json
{
  "meta": {
    "status": 400,
    "success": false,
    "message": "Validation failed"
  },
  "error": {
    "context": {}
  }
}
```

## REST Endpoints

### Health

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/health` | No | Server, MongoDB, Redis, and uptime status |

### Auth

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | No | Signup body |
| `POST` | `/api/auth/confirmEmail` | No | Email and OTP |
| `POST` | `/api/auth/signin` | No | Email and password |
| `POST` | `/api/auth/refresh-token` | Refresh token header | None |
| `POST` | `/api/auth/signout` | Access token header | None |

Signup body:

```json
{
  "firstName": "Mohamed",
  "lastName": "Yasser",
  "email": "user@example.com",
  "password": "123456",
  "passwordConfirmation": "123456",
  "gender": "male",
  "DOB": "2000-01-01",
  "phoneNumber": "01000000000"
}
```

Confirm email body:

```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

Signin body:

```json
{
  "email": "user@example.com",
  "password": "123456"
}
```

Signin returns:

```json
{
  "accessToken": "...",
  "refreshToken": "..."
}
```

Notes:

- Signup sends an email verification OTP.
- Users must verify email before signin.
- Signout blacklists the current access token.

### Users, Profile, Friendships, Groups

All routes are protected.

| Method | Path | Description |
| --- | --- | --- |
| `PUT` | `/api/users/update-profile` | Update logged-in user profile |
| `POST` | `/api/users/profile-picture` | Upload profile picture |
| `POST` | `/api/users/renew-signed-url` | Renew signed URL for owned media key |
| `DELETE` | `/api/users/delete-account` | Delete account and related data |
| `POST` | `/api/users/send-friendship-request` | Send friendship request |
| `GET` | `/api/users/list-friendship-requests?status=pending` | List friendship requests |
| `PATCH` | `/api/users/respond-to-friendship-request` | Accept/reject request |
| `POST` | `/api/users/create-group` | Create group conversation |

Update profile body may include one or more fields:

```json
{
  "firstName": "Mohamed",
  "lastName": "Yasser",
  "email": "new@example.com",
  "gender": "male",
  "DOB": "2000-01-01",
  "phoneNumber": "01000000000"
}
```

Changing email marks the user as unverified again.

Renew signed URL body:

```json
{
  "key": "s3-object-key",
  "keyType": "profilePicture"
}
```

Friendship request body:

```json
{
  "requestToId": "userObjectId"
}
```

Friendship response body:

```json
{
  "friendRequestId": "friendshipObjectId",
  "response": "accepted"
}
```

Allowed friendship values:

```txt
pending
accepted
rejected
```

Create group body:

```json
{
  "name": "Friends",
  "memberIds": ["userObjectId"]
}
```

Only accepted friends can be added to a group.

### Posts

All routes are protected.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/posts/add-post` | Create post |
| `GET` | `/api/posts/home?page=1&limit=10` | List home feed posts |
| `GET` | `/api/posts/user/me` | List logged-in user's posts |
| `GET` | `/api/posts/user/:userId` | List a user's posts |
| `PATCH` | `/api/posts/:postId` | Update post |
| `DELETE` | `/api/posts/:postId` | Delete post |

Create post uses multipart form-data:

```txt
description: optional string
allowComments: optional boolean
tags: optional user id, can be repeated
files: optional image files, max 3
```

At least `description` or one file is required.

Update post uses multipart form-data:

```txt
description: optional string
allowComments: optional boolean
tags: optional user id, can be repeated
removeAttachments: optional S3 key, can be repeated
files: optional image files, max 3
```

### Comments

All routes are protected.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/comments` | Create comment |
| `GET` | `/api/comments/:onModel/:refId` | List comments |
| `PATCH` | `/api/comments/:commentId` | Update comment |
| `DELETE` | `/api/comments/:commentId` | Delete comment |

Allowed `onModel` values:

```txt
Post
Comment
```

Create comment body:

```json
{
  "content": "Nice post",
  "refId": "postOrCommentObjectId",
  "onModel": "Post"
}
```

At least `content` or `attachments` is required.

Update comment body:

```json
{
  "content": "Updated comment"
}
```

### Reacts

All routes are protected.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/reacts` | Add/update react |
| `GET` | `/api/reacts/:onModel/:refId` | List reacts |
| `DELETE` | `/api/reacts/:onModel/:refId` | Delete logged-in user's react |

Allowed react types:

```txt
like
love
haha
sad
angry
```

Allowed `onModel` values:

```txt
Post
Comment
```

React body:

```json
{
  "type": "like",
  "refId": "postOrCommentObjectId",
  "onModel": "Post"
}
```

## Uploads

Profile pictures and post attachments use image uploads.

| Rule | Value |
| --- | --- |
| MIME types | `image/jpeg`, `image/png`, `image/webp` |
| Extensions | `.jpg`, `.jpeg`, `.png`, `.webp` |
| Max file size | `5MB` |
| Max post files | `3` |

Upload field names:

| Route | Field |
| --- | --- |
| `POST /api/users/profile-picture` | `profilePicture` |
| `POST /api/posts/add-post` | `files` |
| `PATCH /api/posts/:postId` | `files` |

## GraphQL

Endpoint:

```txt
POST /graphql
```

Auth:

```txt
Authorization: Bearer <accessToken>
```

Available queries:

| Query | Purpose |
| --- | --- |
| `feed` | Feed posts with owner, comments count, react summary, and current user's react |
| `postDetails(postId: ID!)` | Single post with comments |
| `profileDashboard` | Current user, recent posts, friendship summary, groups |
| `conversations` | Current user's conversations with members and last message |

Feed example:

```graphql
query {
  feed {
    id
    description
    attachments
    commentsCount
    myReact
    reactsSummary {
      like
      love
      haha
      sad
      angry
      total
    }
    owner {
      id
      firstName
      lastName
      profilePicture
    }
  }
}
```

Post details example:

```graphql
query {
  postDetails(postId: "postObjectId") {
    id
    description
    comments {
      id
      content
      owner {
        id
        firstName
      }
    }
  }
}
```

Profile dashboard example:

```graphql
query {
  profileDashboard {
    currentUser {
      id
      firstName
      lastName
      email
    }
    friendshipSummary {
      pendingReceived
      pendingSent
      friends
    }
    recentPosts {
      id
      description
    }
    groups {
      id
      name
    }
  }
}
```

Conversations example:

```graphql
query {
  conversations {
    id
    type
    name
    members {
      id
      firstName
      lastName
    }
    lastMessage {
      id
      text
      createdAt
    }
  }
}
```

## Socket.IO

Connection auth:

```ts
io(API_URL, {
  auth: {
    authorization: 'Bearer <accessToken>',
  },
})
```

| Event | Client Payload | Server Event |
| --- | --- | --- |
| `send-private-message` | `{ "text": "Hello", "targetUserId": "userObjectId" }` | `message-sent` |
| `get-chat-history` | `"targetUserObjectId"` | `chat-history` |
| `send-group-message` | `{ "text": "Hello group", "targetGroupId": "conversationObjectId" }` | `message-sent` |
| `get-group-chat` | `"conversationObjectId"` | `group-chat-history` |

Invalid socket payloads emit:

```json
{
  "message": "Invalid socket event payload"
}
```

## Rate Limits

Redis-backed rate limiting applies to:

- global API requests
- signup
- signin
- confirm email
- uploads
- GraphQL
- socket auth
- socket message/read events

When limited, the API returns `429` with the standard error response shape.
