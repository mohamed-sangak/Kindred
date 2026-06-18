// Domain schemas for response payloads. Responses are not built from Zod, so these are
// transcribed from the Mongoose models (src/Db/Models) and the service handlers' SuccessResponse data.
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

const objectIdString = { type: 'string', description: 'MongoDB ObjectId (24-character hex string)' }

// Populated owner/member fields are returned either as a raw id or, on list endpoints, populated
// with this projection (see the `populate` selects in the comment/react/profile services).
const userReference = { oneOf: [objectIdString, ref('UserSummary')] }

const timestamps = {
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
}

export const responseSchemas = {
  UserSummary: {
    type: 'object',
    properties: {
      _id: objectIdString,
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      profilePicture: { type: 'string', nullable: true },
    },
  },

  // Shape returned by AuthService.toAuthUserResponse (signup).
  AuthUser: {
    type: 'object',
    properties: {
      _id: objectIdString,
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      email: { type: 'string', format: 'email' },
      gender: { type: 'string', enum: ['male', 'female', 'other'] },
      DOB: { type: 'string', format: 'date-time', nullable: true },
      profilePicture: { type: 'string', nullable: true },
      coverPicture: { type: 'string', nullable: true },
      provider: { type: 'string', enum: ['local', 'google'] },
      role: { type: 'string', enum: ['admin', 'user'] },
      isVerified: { type: 'boolean', nullable: true },
    },
  },

  // User document with the password projected out (update-profile).
  User: {
    type: 'object',
    properties: {
      _id: objectIdString,
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['admin', 'user'] },
      gender: { type: 'string', enum: ['male', 'female', 'other'] },
      DOB: { type: 'string', format: 'date-time', nullable: true },
      profilePicture: { type: 'string', nullable: true },
      coverPicture: { type: 'string', nullable: true },
      provider: { type: 'string', enum: ['local', 'google'] },
      phoneNumber: { type: 'string', nullable: true },
      isVerified: { type: 'boolean', nullable: true },
      ...timestamps,
    },
  },

  // get-profile-data: the authenticated User plus freshly signed URLs for the two pictures.
  ProfileData: {
    allOf: [
      ref('User'),
      {
        type: 'object',
        properties: {
          profilePictureUrl: { type: 'string', format: 'uri', nullable: true },
          coverPictureUrl: { type: 'string', format: 'uri', nullable: true },
        },
      },
    ],
  },

  // Public user projection returned by list-users (raw S3 keys, not signed URLs).
  UserListItem: {
    type: 'object',
    properties: {
      _id: objectIdString,
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      gender: { type: 'string', enum: ['male', 'female', 'other'] },
      profilePicture: { type: 'string', nullable: true },
      coverPicture: { type: 'string', nullable: true },
    },
  },

  Post: {
    type: 'object',
    properties: {
      _id: objectIdString,
      description: { type: 'string', nullable: true },
      attachments: { type: 'array', items: { type: 'string' } },
      ownerId: userReference,
      allowComments: { type: 'boolean' },
      tags: { type: 'array', items: objectIdString },
      ...timestamps,
    },
  },

  // mongoose-paginate-v2 result for PostRepository.postsPagination.
  PaginatedPosts: {
    type: 'object',
    properties: {
      docs: { type: 'array', items: ref('Post') },
      totalDocs: { type: 'integer' },
      limit: { type: 'integer' },
      page: { type: 'integer' },
      totalPages: { type: 'integer' },
      pagingCounter: { type: 'integer' },
      hasPrevPage: { type: 'boolean' },
      hasNextPage: { type: 'boolean' },
      prevPage: { type: 'integer', nullable: true },
      nextPage: { type: 'integer', nullable: true },
    },
  },

  Comment: {
    type: 'object',
    properties: {
      _id: objectIdString,
      content: { type: 'string', nullable: true },
      attachments: { type: 'string', nullable: true },
      ownerId: userReference,
      refId: objectIdString,
      onModel: { type: 'string', enum: ['Post', 'Comment'] },
      ...timestamps,
    },
  },

  React: {
    type: 'object',
    properties: {
      _id: objectIdString,
      type: { type: 'string', enum: ['like', 'love', 'haha', 'sad', 'angry'] },
      ownerId: userReference,
      refId: objectIdString,
      onModel: { type: 'string', enum: ['Post', 'Comment'] },
      ...timestamps,
    },
  },

  FriendshipRequest: {
    type: 'object',
    properties: {
      _id: objectIdString,
      requestFromId: userReference,
      requestToId: userReference,
      status: { type: 'string', enum: ['pending', 'accepted', 'rejected'] },
      friendshipKey: { type: 'string' },
      ...timestamps,
    },
  },

  Group: {
    type: 'object',
    properties: {
      _id: objectIdString,
      type: { type: 'string', enum: ['direct', 'group'] },
      name: { type: 'string', nullable: true },
      members: { type: 'array', items: objectIdString },
      directKey: { type: 'string', nullable: true },
      ...timestamps,
    },
  },
}
