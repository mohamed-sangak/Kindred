import { Router } from 'express'
import { authentication, Multer, uploadRateLimitMiddleware, validationMiddleware } from '../../../Middlewares'
import profileService from '../services/profile.service'
import {
  CreateGroupValidator,
  ListFriendShipRequestsValidator,
  ListUsersValidator,
  RenewSignedUrlValidator,
  RespondToFriendShipRequestValidator,
  SendFriendShipRequestValidator,
  UpdateProfileValidator,
} from '../../../Validators'

const profileController = Router()

//update profile
profileController.put('/update-profile', authentication, validationMiddleware(UpdateProfileValidator), profileService.updateProfile)

//delete profile
profileController.delete('/delete-account', authentication, profileService.deletAccount)

//get profile data
profileController.get('/profile-data', authentication, profileService.getProfileData)

//upload profile picture
profileController.post('/profile-picture', authentication, uploadRateLimitMiddleware, Multer().single('profilePicture'), profileService.uploadProfilePicture)

//renew signed url
profileController.post('/renew-signed-url', authentication, validationMiddleware(RenewSignedUrlValidator), profileService.renewSignedUrl)

//upload cover picture
profileController.post('/cover-picture', authentication, uploadRateLimitMiddleware, Multer().single('coverPicture'), profileService.uploadCoverPicture)

// list all users
profileController.get('/users', authentication, validationMiddleware(ListUsersValidator), profileService.listUsers)

// send friendship request
profileController.post('/send-friendship-request', authentication, validationMiddleware(SendFriendShipRequestValidator), profileService.sendFriendShipRequest)

//list friendship requests
profileController.get('/list-friendship-requests', authentication, validationMiddleware(ListFriendShipRequestsValidator), profileService.listRequests)

//respond to friendship request
profileController.patch('/respond-to-friendship-request', authentication, validationMiddleware(RespondToFriendShipRequestValidator), profileService.respondToFriendShipRequest)


profileController.post('/create-group', authentication, validationMiddleware(CreateGroupValidator), profileService.createGroup)

export { profileController }
