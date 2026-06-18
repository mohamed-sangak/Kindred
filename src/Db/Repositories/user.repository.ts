import { FilterQuery, Model } from 'mongoose'
import { IUser } from '../../Common'
import { BaseRepository } from './base.repository'

export class UserRepository extends BaseRepository<IUser> {
  constructor(protected _userModel: Model<IUser>) {
    super(_userModel)
  }

  async countDocuments(filters: FilterQuery<IUser> = {}) {
    return await this._userModel.countDocuments(filters)
  }
}
