import { Request, Response } from 'express'
import { FilterQuery } from 'mongoose'
import { ChatTypeEnum, FriendShipStatusEnum, IFriendShip, IRequest } from '../../../Common'
import { CommentModel, ConversationModel, FriendShipModel, MessageModel, PostModel, ReactModel, UserModel } from '../../../Db/Models'
import { CommentRepository, ConversationRepository, FriendShipRepository, MessageRepository, PostRepository, ReactRepository, UserRepository } from '../../../Db/Repositories'
import { BadRequestException, ConflictException, encrypt, S3ClientService } from '../../../Utils'
import { pagination } from '../../../Utils/Pagination/pagination.utils'
import { SuccessResponse } from '../../../Utils/Response/response-helper.utils'

export class ProfileService {
  private s3Client = new S3ClientService()
  private userRepository = new UserRepository(UserModel)
  private friendShipRepository = new FriendShipRepository(FriendShipModel)
  private conversationRepo = new ConversationRepository(ConversationModel)
  private postRepo = new PostRepository()
  private commentRepo = new CommentRepository(CommentModel)
  private reactRepo = new ReactRepository(ReactModel)
  private messageRepo = new MessageRepository(MessageModel)

  private async collectCommentTreeIds(initialCommentIds: string[]) {
    const allCommentIds = new Set(initialCommentIds)
    let queue = [...initialCommentIds]

    while (queue.length) {
      const childComments = await this.commentRepo.findDocuments({
        onModel: 'Comment',
        refId: { $in: queue },
      })
      const newIds = childComments
        .map((comment) => comment._id.toString())
        .filter((id) => !allCommentIds.has(id))

      newIds.forEach((id) => allCommentIds.add(id))
      queue = newIds
    }

    return Array.from(allCommentIds)
  }

  private async deleteS3Keys(keys: string[]) {
    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)))
    if (!uniqueKeys.length) return

    if (uniqueKeys.length === 1) {
      await this.s3Client.deleteFileFromS3(uniqueKeys[0])
      return
    }

    await this.s3Client.deleteBulkFromS3(uniqueKeys)
  }

  uploadProfilePicture = async (req: Request, res: Response) => {
    const file = req.file
    const { user } = (req as unknown as IRequest).loggedInUser

    if (!file) throw new BadRequestException('No file uploaded')

    const oldProfilePicture = user.profilePicture?.toString()
    const { key, url } = await this.s3Client.uploadFileOnS3(file, `${user._id}/profile`)

    try {
      user.profilePicture = key
      await user.save()
    } catch (error) {
      try {
        await this.s3Client.deleteFileFromS3(key)
      } catch (cleanupError) {
        console.warn('Failed to delete uploaded profile picture after save failure', cleanupError)
      }
      throw error
    }

    if (oldProfilePicture && oldProfilePicture !== key) {
      try {
        await this.s3Client.deleteFileFromS3(oldProfilePicture)
      } catch (error) {
        console.warn('Failed to delete old profile picture from S3', error)
      }
    }

    res.json(
      SuccessResponse('Profile picture uploaded successfully', 200, {
        key,
        url,
      }),
    )
  }

  uploadCoverPicture = async (req: Request, res: Response) => {
    const file = req.file
    const { user } = (req as unknown as IRequest).loggedInUser

    if (!file) throw new BadRequestException('No file uploaded')

    const oldCoverPicture = user.coverPicture?.toString()
    const { key, url } = await this.s3Client.uploadFileOnS3(file, `${user._id}/cover`)

    try {
      user.coverPicture = key
      await user.save()
    } catch (error) {
      try {
        await this.s3Client.deleteFileFromS3(key)
      } catch (cleanupError) {
        console.warn('Failed to delete uploaded cover picture after save failure', cleanupError)
      }
      throw error
    }

    if (oldCoverPicture && oldCoverPicture !== key) {
      try {
        await this.s3Client.deleteFileFromS3(oldCoverPicture)
      } catch (error) {
        console.warn('Failed to delete old cover picture from S3', error)
      }
    }

    res.json(
      SuccessResponse('Cover picture uploaded successfully', 200, {
        key,
        url,
      }),
    )
  }

  getProfileData = async (req: Request, res: Response) => {
    const { user } = (req as unknown as IRequest).loggedInUser

    const [profilePictureUrl, coverPictureUrl] = await Promise.all([
      user.profilePicture ? this.s3Client.getFileWithSignedUrl(user.profilePicture.toString()) : null,
      user.coverPicture ? this.s3Client.getFileWithSignedUrl(user.coverPicture.toString()) : null,
    ])

    const { OTPS, ...profile } = user.toObject()

    res.json(SuccessResponse('Profile data fetched successfully', 200, { ...profile, profilePictureUrl, coverPictureUrl }))
  }

  listUsers = async (req: Request, res: Response) => {
    const {
      user: { _id },
    } = (req as unknown as IRequest).loggedInUser
    const { page, limit } = req.query

    const { limit: currentLimit, skip } = pagination({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    })
    const filters = { _id: { $ne: _id } }

    const [users, total] = await Promise.all([
      this.userRepository.findDocuments(filters, 'firstName lastName gender profilePicture coverPicture', {
        skip,
        limit: currentLimit,
        sort: { createdAt: -1 },
      }),
      this.userRepository.countDocuments(filters),
    ])

    res.json(
      SuccessResponse('Users fetched successfully', 200, {
        users,
        total,
        page: Number(page) || 1,
        limit: currentLimit,
      }),
    )
  }

  renewSignedUrl = async (req: Request, res: Response) => {
    const { user } = (req as unknown as IRequest).loggedInUser
    const { key, keyType }: { key: string; keyType: 'profilePicture' | 'coverPicture' } = req.body

    if (user[keyType] !== key) throw new BadRequestException('Invalid key')

    const url = await this.s3Client.getFileWithSignedUrl(key)

    res.json(SuccessResponse('Signed URL renewed successfully', 200, { key, url }))
  }

  deletAccount = async (req: Request, res: Response) => {
    const { user } = (req as unknown as IRequest).loggedInUser
    const userId = user._id

    const posts = await this.postRepo.findDocuments({ ownerId: userId })
    const postIds = posts.map((post) => post._id.toString())

    const ownedComments = await this.commentRepo.findDocuments({ ownerId: userId })
    const postComments = postIds.length
      ? await this.commentRepo.findDocuments({ refId: { $in: postIds }, onModel: 'Post' })
      : []

    const initialCommentIds = Array.from(
      new Set([...ownedComments, ...postComments].map((comment) => comment._id.toString())),
    )
    const commentIds = await this.collectCommentTreeIds(initialCommentIds)

    const directConversations = await this.conversationRepo.findDocuments({
      type: ChatTypeEnum.DIRECT,
      members: userId,
    })
    const directConversationIds = directConversations.map((conversation) => conversation._id.toString())

    const directMessages = directConversationIds.length
      ? await this.messageRepo.findDocuments({ conversationId: { $in: directConversationIds } })
      : []
    const ownedMessages = await this.messageRepo.findDocuments({ senderId: userId })

    const s3Keys = [
      user.profilePicture?.toString(),
      user.coverPicture?.toString(),
      ...posts.flatMap((post) => (post.attachments || []).map((attachment) => attachment.toString())),
      ...ownedComments.map((comment) => comment.attachments?.toString()).filter(Boolean),
      ...directMessages.flatMap((message) => (message.attachments || []).map((attachment) => attachment.toString())),
      ...ownedMessages.flatMap((message) => (message.attachments || []).map((attachment) => attachment.toString())),
    ].filter(Boolean) as string[]

    await this.deleteS3Keys(s3Keys)

    if (commentIds.length) {
      await this.reactRepo.deleteDocuments({ refId: { $in: commentIds }, onModel: 'Comment' })
      await this.commentRepo.deleteDocuments({ _id: { $in: commentIds } })
    }

    if (postIds.length) {
      await this.reactRepo.deleteDocuments({ refId: { $in: postIds }, onModel: 'Post' })
      await this.postRepo.deleteDocuments({ _id: { $in: postIds } })
    }

    await this.reactRepo.deleteDocuments({ ownerId: userId })
    await this.friendShipRepository.deleteDocuments({
      $or: [{ requestFromId: userId }, { requestToId: userId }],
    })

    if (directConversationIds.length) {
      await this.messageRepo.deleteDocuments({ conversationId: { $in: directConversationIds } })
      await this.conversationRepo.deleteDocuments({ _id: { $in: directConversationIds } })
    }

    await ConversationModel.updateMany(
      { type: ChatTypeEnum.GROUP, members: userId },
      { $pull: { members: userId } },
    )

    const emptyGroups = await this.conversationRepo.findDocuments({
      type: ChatTypeEnum.GROUP,
      members: { $size: 0 },
    })
    const emptyGroupIds = emptyGroups.map((conversation) => conversation._id.toString())

    if (emptyGroupIds.length) {
      await this.messageRepo.deleteDocuments({ conversationId: { $in: emptyGroupIds } })
      await this.conversationRepo.deleteDocuments({ _id: { $in: emptyGroupIds } })
    }

    await this.messageRepo.deleteDocuments({ senderId: userId })
    await PostModel.updateMany({ tags: userId }, { $pull: { tags: userId } })

    const deletedDocument = await this.userRepository.deleteByIdDocument(userId)
    if (!deletedDocument) throw new BadRequestException('User not found')

    res.json(SuccessResponse('Account deleted successfully', 200))
  }

  updateProfile = async (req: Request, res: Response) => {
    const { user } = (req as unknown as IRequest).loggedInUser
    const { firstName, lastName, email, gender, DOB, phoneNumber } = req.body

    const updates: Partial<typeof user> = {}
    if (firstName !== undefined) updates.firstName = firstName
    if (lastName !== undefined) updates.lastName = lastName
    if (gender !== undefined) updates.gender = gender
    if (DOB !== undefined) updates.DOB = new Date(DOB)
    if (phoneNumber !== undefined) updates.phoneNumber = encrypt(phoneNumber)

    if (email !== undefined && email !== user.email) {
      const existingUser = await this.userRepository.findOneDocument({ email }, 'email')
      if (existingUser) throw new ConflictException('Email already exists, please try with another email.', { invalidEmail: email })
      updates.email = email
      updates.isVerified = false
    }

    if (!Object.keys(updates).length) throw new BadRequestException('Nothing to update')

    const updatedUser = await this.userRepository.updateDocumentById({ _id: user._id }, updates, {
      new: true,
      projection: '-password',
    })

    res.json(SuccessResponse('Profile updated successfully', 200, updatedUser))
  }

  sendFriendShipRequest = async (req: Request, res: Response) => {
    const {
      user: { _id },
    } = (req as unknown as IRequest).loggedInUser
    const { requestToId } = req.body

    if (_id.toString() === requestToId) throw new BadRequestException('You cannot send a friendship request to yourself')

    const user = await this.userRepository.findDocumentById(requestToId)
    if (!user) throw new BadRequestException('User not found')

    const existingRequest = await this.friendShipRepository.findOneDocument({
      $or: [
        { requestFromId: _id, requestToId },
        { requestFromId: requestToId, requestToId: _id },
      ],
    })
    if (existingRequest) throw new ConflictException('Friendship request already exists')

    await this.friendShipRepository.createNewDocument({
      requestFromId: _id,
      requestToId,
    })

    res.json(SuccessResponse('Friendship request sent successfully', 200))
  }

  listRequests = async (req: Request, res: Response) => {
    const {
      user: { _id }
    } = (req as unknown as IRequest).loggedInUser
    const { status } = req.query

    const filters: FilterQuery<IFriendShip> = {
      status: status ? status : FriendShipStatusEnum.PENDING,
    }
    if (filters.status == FriendShipStatusEnum.ACCEPTED) filters.$or = [{ requestFromId: _id }, { requestToId: _id }]
    else filters.requestToId = _id

    const requests = await this.friendShipRepository.findDocuments(filters, undefined, {
      populate: [
        {
          path: 'requestFromId',
          select: 'firstName lastName profilePicture',
        },
        {
          path: 'requestToId',
          select: 'firstName lastName profilePicture',
        },
      ],
    })

    const groups = await this.conversationRepo.findDocuments({ type: 'group', members: { $in: _id } })

    res.json(SuccessResponse('Friendship requests fetched successfully', 200, { requests, groups }))
  }

  respondToFriendShipRequest = async (req: Request, res: Response) => {
    const {
      user: { _id },
    } = (req as IRequest).loggedInUser
    const { friendRequestId, response } = req.body

    const friendRequest = await this.friendShipRepository.findOneDocument({
      _id: friendRequestId,
      requestToId: _id,
      status: FriendShipStatusEnum.PENDING,
    })
    if (!friendRequest) throw new BadRequestException('Friendship request not found')

    friendRequest.status = response
    await friendRequest.save()

    res.json(SuccessResponse<IFriendShip>('Friendship request responded successfully', 200, friendRequest))
  }


  createGroup = async (req: Request, res: Response) => {
    const { user: { _id } } = (req as IRequest).loggedInUser
    const { name, memberIds } = req.body

    const uniqueMemberIds = Array.from(new Set(memberIds)).filter((memberId) => memberId !== _id.toString())
    if (!uniqueMemberIds.length) throw new BadRequestException('Group must include at least one other member')

    const members = await this.userRepository.findDocuments({ _id: { $in: uniqueMemberIds } })
    if (members.length !== uniqueMemberIds.length) throw new BadRequestException('One or more users not found')

    const friendship = await this.friendShipRepository.findDocuments({
      $or: [
        { requestFromId: _id, requestToId: { $in: uniqueMemberIds } },
        { requestFromId: { $in: uniqueMemberIds }, requestToId: _id }
      ],
      status: FriendShipStatusEnum.ACCEPTED
    })
    if (friendship.length !== uniqueMemberIds.length) throw new BadRequestException('You can only create group with your friends')

    const group = await this.conversationRepo.createNewDocument({
      type: ChatTypeEnum.GROUP,
      name,
      members: [_id, ...uniqueMemberIds],
    })


    res.json(SuccessResponse('Group created successfully', 200, group))
  }

}

export default new ProfileService()
