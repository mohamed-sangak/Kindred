import { z } from 'zod'
import { FriendShipStatusEnum, GenderEnum } from '../../Common'
import { objectId } from './auth.validator'

const optionalProfileUpdates = z.object({
  firstName: z.string().min(3).optional(),
  lastName: z.string().min(3).optional(),
  email: z.email().optional(),
  gender: z.enum(GenderEnum).optional(),
  DOB: z.iso.date().optional(),
  phoneNumber: z.string().regex(/^\d{11}$/, 'phone number must be exactly 11 digits').optional(),
})

export const UpdateProfileValidator = {
  body: optionalProfileUpdates.strict().refine((value) => Object.keys(value).length > 0, 'Nothing to update'),
}

export const RenewSignedUrlValidator = {
  body: z.strictObject({
    key: z.string().min(1),
    keyType: z.enum(['profilePicture', 'coverPicture']),
  }),
}

export const ListUsersValidator = {
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }).strict(),
}

export const SendFriendShipRequestValidator = {
  body: z.strictObject({
    requestToId: objectId,
  }),
}

export const ListFriendShipRequestsValidator = {
  query: z.object({
    status: z.enum(FriendShipStatusEnum).optional(),
  }).strict(),
}

export const RespondToFriendShipRequestValidator = {
  body: z.strictObject({
    friendRequestId: objectId,
    response: z.enum([FriendShipStatusEnum.ACCEPTED, FriendShipStatusEnum.REJECTED]),
  }),
}

export const CreateGroupValidator = {
  body: z.strictObject({
    name: z.string().min(1).max(50),
    memberIds: z.array(objectId).min(1),
  }),
}
