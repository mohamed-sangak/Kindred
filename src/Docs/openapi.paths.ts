// OpenAPI operations for every REST route. Request bodies/params reference the Zod-generated
// component schemas (openapi.registry) and the domain schemas (openapi.responses); paths, methods,
// auth, and response data shapes are transcribed from the controllers and service handlers.

const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const errorRef = (name: string) => ({ $ref: `#/components/responses/${name}` })

const bearer = [{ bearerAuth: [] }]

const jsonBody = (schemaName: string) => ({
  required: true,
  content: { 'application/json': { schema: schemaRef(schemaName) } },
})

const postFiles = {
  type: 'array',
  items: { type: 'string', format: 'binary' },
  maxItems: 3,
  description: 'Image files (jpeg/png/webp, up to 5MB each, max 3)',
}

const multipartWithFiles = (bodySchemaName: string, required: boolean) => ({
  required,
  content: {
    'multipart/form-data': {
      schema: { allOf: [schemaRef(bodySchemaName), { type: 'object', properties: { files: postFiles } }] },
    },
  },
})

// Composes the shared success envelope with the endpoint-specific `data` shape.
const success = (description: string, dataSchema?: object) => ({
  description,
  content: {
    'application/json': {
      schema: dataSchema ? { allOf: [schemaRef('SuccessResponse'), { type: 'object', properties: { data: dataSchema } }] } : schemaRef('SuccessResponse'),
    },
  },
})

const objectIdParam = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: schemaRef('ObjectId'),
})

const onModelParam = {
  name: 'onModel',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: ['Post', 'Comment'] },
}

const pageParam = { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } }
const limitParam = { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } }
const statusParam = { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['pending', 'accepted', 'rejected'] } }

const tokenData = { type: 'object', properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' } } }
const accessTokenData = { type: 'object', properties: { accessToken: { type: 'string' } } }
const s3KeyData = { type: 'object', properties: { key: { type: 'string' }, url: { type: 'string', format: 'uri' } } }
const postWrapper = { type: 'object', properties: { post: schemaRef('Post') } }
const postsWrapper = { type: 'object', properties: { posts: schemaRef('PaginatedPosts') } }
const friendshipListData = {
  type: 'object',
  properties: {
    requests: { type: 'array', items: schemaRef('FriendshipRequest') },
    groups: { type: 'array', items: schemaRef('Group') },
  },
}
const listUsersData = {
  type: 'object',
  properties: {
    users: { type: 'array', items: schemaRef('UserListItem') },
    total: { type: 'integer' },
    page: { type: 'integer' },
    limit: { type: 'integer' },
  },
}
const healthData = {
  type: 'object',
  properties: {
    server: { type: 'string' },
    mongo: { type: 'string', enum: ['connected', 'disconnected'] },
    redis: { type: 'string' },
    uptime: { type: 'number' },
  },
}

export const paths = {
  '/health': {
    get: {
      tags: ['System'],
      summary: 'Liveness/readiness check (server, MongoDB, Redis, uptime)',
      responses: { '200': success('Health check completed', healthData) },
    },
  },

  '/api/auth/signup': {
    post: {
      tags: ['Auth'],
      summary: 'Register a new user and email a verification OTP',
      requestBody: jsonBody('SignUpBody'),
      responses: {
        '201': success('User registered successfully', schemaRef('AuthUser')),
        '400': errorRef('BadRequest'),
        '409': errorRef('Conflict'),
        '429': errorRef('TooManyRequests'),
      },
    },
  },
  '/api/auth/confirmEmail': {
    post: {
      tags: ['Auth'],
      summary: 'Verify an email address with the OTP',
      requestBody: jsonBody('ConfirmEmailBody'),
      responses: {
        '200': success('Email verified successfully'),
        '400': errorRef('BadRequest'),
        '404': errorRef('NotFound'),
        '429': errorRef('TooManyRequests'),
      },
    },
  },
  '/api/auth/signin': {
    post: {
      tags: ['Auth'],
      summary: 'Sign in and receive access + refresh tokens',
      requestBody: jsonBody('SignInBody'),
      responses: {
        '200': success('User signed in successfully', tokenData),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '429': errorRef('TooManyRequests'),
      },
    },
  },
  '/api/auth/refresh-token': {
    post: {
      tags: ['Auth'],
      summary: 'Exchange a refresh token (in the Authorization header) for a new access token',
      parameters: [
        {
          name: 'Authorization',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 'Refresh token as `Bearer <refreshToken>`',
        },
      ],
      responses: {
        '200': success('Access token refreshed successfully', accessTokenData),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
  },
  '/api/auth/signout': {
    post: {
      tags: ['Auth'],
      summary: 'Sign out and blacklist the current access + refresh tokens',
      security: bearer,
      requestBody: jsonBody('SignOutBody'),
      responses: {
        '200': success('User signed out successfully'),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
      },
    },
  },

  '/api/users/update-profile': {
    put: {
      tags: ['Users'],
      summary: 'Update the authenticated user profile',
      security: bearer,
      requestBody: jsonBody('UpdateProfileBody'),
      responses: {
        '200': success('Profile updated successfully', schemaRef('User')),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '409': errorRef('Conflict'),
      },
    },
  },
  '/api/users/delete-account': {
    delete: {
      tags: ['Users'],
      summary: 'Delete the authenticated account and all owned data',
      security: bearer,
      responses: {
        '200': success('Account deleted successfully'),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
      },
    },
  },
  '/api/users/profile-data': {
    get: {
      tags: ['Users'],
      summary: 'Get the authenticated user profile with signed picture URLs',
      security: bearer,
      responses: {
        '200': success('Profile data fetched successfully', schemaRef('ProfileData')),
        '401': errorRef('Unauthorized'),
      },
    },
  },
  '/api/users/users': {
    get: {
      tags: ['Users'],
      summary: 'List users (paginated, excludes the authenticated user)',
      security: bearer,
      parameters: [pageParam, limitParam],
      responses: {
        '200': success('Users fetched successfully', listUsersData),
        '401': errorRef('Unauthorized'),
      },
    },
  },
  '/api/users/profile-picture': {
    post: {
      tags: ['Users'],
      summary: 'Upload/replace the profile picture',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: { type: 'object', required: ['profilePicture'], properties: { profilePicture: { type: 'string', format: 'binary' } } },
          },
        },
      },
      responses: {
        '200': success('Profile picture uploaded successfully', s3KeyData),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '413': errorRef('PayloadTooLarge'),
        '429': errorRef('TooManyRequests'),
      },
    },
  },
  '/api/users/cover-picture': {
    post: {
      tags: ['Users'],
      summary: 'Upload/replace the cover picture',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: { type: 'object', required: ['coverPicture'], properties: { coverPicture: { type: 'string', format: 'binary' } } },
          },
        },
      },
      responses: {
        '200': success('Cover picture uploaded successfully', s3KeyData),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '413': errorRef('PayloadTooLarge'),
        '429': errorRef('TooManyRequests'),
      },
    },
  },
  '/api/users/renew-signed-url': {
    post: {
      tags: ['Users'],
      summary: 'Renew a signed URL for a stored profile/cover key',
      security: bearer,
      requestBody: jsonBody('RenewSignedUrlBody'),
      responses: {
        '200': success('Signed URL renewed successfully', s3KeyData),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
      },
    },
  },
  '/api/users/send-friendship-request': {
    post: {
      tags: ['Users'],
      summary: 'Send a friendship request to another user',
      security: bearer,
      requestBody: jsonBody('SendFriendshipRequestBody'),
      responses: {
        '200': success('Friendship request sent successfully'),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '409': errorRef('Conflict'),
      },
    },
  },
  '/api/users/list-friendship-requests': {
    get: {
      tags: ['Users'],
      summary: 'List friendship requests (and the user groups)',
      security: bearer,
      parameters: [statusParam],
      responses: {
        '200': success('Friendship requests fetched successfully', friendshipListData),
        '401': errorRef('Unauthorized'),
      },
    },
  },
  '/api/users/respond-to-friendship-request': {
    patch: {
      tags: ['Users'],
      summary: 'Accept or reject a pending friendship request',
      security: bearer,
      requestBody: jsonBody('RespondToFriendshipRequestBody'),
      responses: {
        '200': success('Friendship request responded successfully', schemaRef('FriendshipRequest')),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
      },
    },
  },
  '/api/users/create-group': {
    post: {
      tags: ['Users'],
      summary: 'Create a group conversation with friends',
      security: bearer,
      requestBody: jsonBody('CreateGroupBody'),
      responses: {
        '200': success('Group created successfully', schemaRef('Group')),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
      },
    },
  },

  '/api/posts/add-post': {
    post: {
      tags: ['Posts'],
      summary: 'Create a post with optional image attachments',
      security: bearer,
      requestBody: multipartWithFiles('CreatePostBody', true),
      responses: {
        '201': success('Post created successfully', postWrapper),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '413': errorRef('PayloadTooLarge'),
        '429': errorRef('TooManyRequests'),
      },
    },
  },
  '/api/posts/{postId}': {
    parameters: [objectIdParam('postId')],
    patch: {
      tags: ['Posts'],
      summary: 'Update a post (add/remove attachments, edit fields)',
      security: bearer,
      requestBody: multipartWithFiles('UpdatePostBody', false),
      responses: {
        '200': success('Post updated successfully', postWrapper),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
        '413': errorRef('PayloadTooLarge'),
        '429': errorRef('TooManyRequests'),
      },
    },
    delete: {
      tags: ['Posts'],
      summary: 'Delete a post and its comments/reacts',
      security: bearer,
      responses: {
        '200': success('Post deleted successfully'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
  },
  '/api/posts/home': {
    get: {
      tags: ['Posts'],
      summary: 'List the home feed (paginated)',
      security: bearer,
      parameters: [pageParam, limitParam],
      responses: {
        '200': success('Posts fetched successfully', postsWrapper),
        '401': errorRef('Unauthorized'),
      },
    },
  },
  '/api/posts/user/me': {
    get: {
      tags: ['Posts'],
      summary: "List the authenticated user's posts (paginated)",
      security: bearer,
      parameters: [pageParam, limitParam],
      responses: {
        '200': success('User posts fetched successfully', postsWrapper),
        '401': errorRef('Unauthorized'),
      },
    },
  },
  '/api/posts/user/{userId}': {
    get: {
      tags: ['Posts'],
      summary: "List another user's posts (paginated)",
      security: bearer,
      parameters: [objectIdParam('userId'), pageParam, limitParam],
      responses: {
        '200': success('User posts fetched successfully', postsWrapper),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
  },

  '/api/comments': {
    post: {
      tags: ['Comments'],
      summary: 'Create a comment on a post or comment',
      security: bearer,
      requestBody: jsonBody('CreateCommentBody'),
      responses: {
        '201': success('Comment created successfully', schemaRef('Comment')),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
  },
  '/api/comments/{onModel}/{refId}': {
    get: {
      tags: ['Comments'],
      summary: 'List comments for a post or comment',
      security: bearer,
      parameters: [onModelParam, objectIdParam('refId')],
      responses: {
        '200': success('Comments fetched successfully', { type: 'array', items: schemaRef('Comment') }),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
  },
  '/api/comments/{commentId}': {
    parameters: [objectIdParam('commentId')],
    patch: {
      tags: ['Comments'],
      summary: 'Update an owned comment',
      security: bearer,
      requestBody: jsonBody('UpdateCommentBody'),
      responses: {
        '200': success('Comment updated successfully', schemaRef('Comment')),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
    delete: {
      tags: ['Comments'],
      summary: 'Delete an owned comment and its replies',
      security: bearer,
      responses: {
        '200': success('Comment deleted successfully'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
  },

  '/api/reacts': {
    post: {
      tags: ['Reacts'],
      summary: 'Add or change a reaction on a post or comment',
      security: bearer,
      requestBody: jsonBody('UpsertReactBody'),
      responses: {
        '200': success('React saved successfully', schemaRef('React')),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
  },
  '/api/reacts/{onModel}/{refId}': {
    parameters: [onModelParam, objectIdParam('refId')],
    get: {
      tags: ['Reacts'],
      summary: 'List reactions for a post or comment',
      security: bearer,
      responses: {
        '200': success('Reacts fetched successfully', { type: 'array', items: schemaRef('React') }),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
    delete: {
      tags: ['Reacts'],
      summary: 'Remove the authenticated user reaction',
      security: bearer,
      responses: {
        '200': success('React deleted successfully'),
        '400': errorRef('BadRequest'),
        '401': errorRef('Unauthorized'),
        '404': errorRef('NotFound'),
      },
    },
  },
}
