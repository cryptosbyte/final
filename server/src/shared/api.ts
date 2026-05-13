import * as zod from "zod";

export type AuthUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

/**
 * Returns server health status
 * @summary Health check
 */
export const HealthCheckResponse = zod.object({
  status: zod.string(),
});

/**
 * @summary Get current authenticated user
 */
export const GetCurrentAuthUserResponse = zod.object({
  user: zod.union([
    zod.object({
      id: zod.string(),
      email: zod.string().nullish(),
      firstName: zod.string().nullish(),
      lastName: zod.string().nullish(),
      profileImageUrl: zod.string().nullish(),
    }),
    zod.null(),
  ]),
});

/**
 * @summary Exchange mobile authorization code for session token
 */
export const ExchangeMobileAuthorizationCodeBody = zod.object({
  code: zod.string(),
  code_verifier: zod.string(),
  redirect_uri: zod.string(),
  state: zod.string(),
  nonce: zod.string().optional(),
});

export const ExchangeMobileAuthorizationCodeResponse = zod.object({
  token: zod.string(),
});

/**
 * @summary Logout mobile session
 */
export const LogoutMobileSessionResponse = zod.object({
  success: zod.boolean(),
});

/**
 * @summary Get all revision data for the current user
 */
export const GetRevisionDataResponse = zod.object({
  data: zod.record(zod.string(), zod.record(zod.string(), zod.unknown())),
});

/**
 * @summary Request a presigned URL for file upload
 */

export const RequestUploadUrlBody = zod.object({
  name: zod.string().min(1),
  size: zod.number().min(1),
  contentType: zod.string().min(1),
});

export const RequestUploadUrlResponse = zod.object({
  uploadURL: zod.string(),
  objectPath: zod.string(),
  metadata: zod.record(zod.string(), zod.unknown()).optional(),
});

/**
 * @summary Serve an object entity from PRIVATE_OBJECT_DIR
 */
export const GetStorageObjectParams = zod.object({
  objectPath: zod.coerce.string(),
});

/**
 * @summary List user folders
 */
export const ListFoldersResponse = zod.object({
  folders: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Create a new folder
 */
export const createFolderBodyNameMax = 200;

export const CreateFolderBody = zod.object({
  name: zod.string().min(1).max(createFolderBodyNameMax),
});

export const CreateFolderResponse = zod.object({
  id: zod.string(),
  name: zod.string(),
  createdAt: zod.string(),
});

export const RenameFolderParams = zod.object({
  id: zod.coerce.string(),
});

export const renameFolderBodyNameMax = 200;

export const RenameFolderBody = zod.object({
  name: zod.string().min(1).max(renameFolderBodyNameMax),
});

export const RenameFolderResponse = zod.object({
  id: zod.string(),
  name: zod.string(),
  createdAt: zod.string(),
});

export const DeleteFolderParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteFolderResponse = zod.object({
  success: zod.boolean(),
});

export const ListPhotosQueryParams = zod.object({
  folderId: zod.coerce.string().optional(),
});

export const ListPhotosResponse = zod.object({
  photos: zod.array(
    zod.object({
      id: zod.string(),
      folderId: zod.string().nullish(),
      name: zod.string(),
      objectPath: zod.string(),
      contentType: zod.string(),
      size: zod.number(),
      uploadedAt: zod.string(),
      deletedAt: zod.string().nullish(),
    }),
  ),
});

export const createPhotoBodyNameMax = 300;

export const createPhotoBodySizeMin = 0;

export const CreatePhotoBody = zod.object({
  folderId: zod.string().nullish(),
  name: zod.string().min(1).max(createPhotoBodyNameMax),
  objectPath: zod.string(),
  contentType: zod.string(),
  size: zod.number().min(createPhotoBodySizeMin),
});

export const CreatePhotoResponse = zod.object({
  id: zod.string(),
  folderId: zod.string().nullish(),
  name: zod.string(),
  objectPath: zod.string(),
  contentType: zod.string(),
  size: zod.number(),
  uploadedAt: zod.string(),
  deletedAt: zod.string().nullish(),
});

/**
 * @summary List photos deleted within the last 5 minutes (undo window)
 */
export const ListRecentlyDeletedPhotosResponse = zod.object({
  photos: zod.array(
    zod.object({
      id: zod.string(),
      folderId: zod.string().nullish(),
      name: zod.string(),
      objectPath: zod.string(),
      contentType: zod.string(),
      size: zod.number(),
      uploadedAt: zod.string(),
      deletedAt: zod.string().nullish(),
    }),
  ),
});

export const UpdatePhotoParams = zod.object({
  id: zod.coerce.string(),
});

export const updatePhotoBodyNameMax = 300;

export const UpdatePhotoBody = zod.object({
  name: zod.string().min(1).max(updatePhotoBodyNameMax).optional(),
  folderId: zod.string().nullish(),
});

export const UpdatePhotoResponse = zod.object({
  id: zod.string(),
  folderId: zod.string().nullish(),
  name: zod.string(),
  objectPath: zod.string(),
  contentType: zod.string(),
  size: zod.number(),
  uploadedAt: zod.string(),
  deletedAt: zod.string().nullish(),
});

export const DeletePhotoParams = zod.object({
  id: zod.coerce.string(),
});

export const DeletePhotoResponse = zod.object({
  success: zod.boolean(),
});

export const RestorePhotoParams = zod.object({
  id: zod.coerce.string(),
});

export const RestorePhotoResponse = zod.object({
  id: zod.string(),
  folderId: zod.string().nullish(),
  name: zod.string(),
  objectPath: zod.string(),
  contentType: zod.string(),
  size: zod.number(),
  uploadedAt: zod.string(),
  deletedAt: zod.string().nullish(),
});

/**
 * @summary Upsert a day entry
 */
export const UpsertRevisionDayParams = zod.object({
  date: zod.coerce.string(),
});

export const UpsertRevisionDayBody = zod.object({
  entry: zod.record(zod.string(), zod.unknown()),
});

export const UpsertRevisionDayResponse = zod.object({
  success: zod.boolean(),
});

/**
 * @summary Delete a day entry
 */
export const DeleteRevisionDayParams = zod.object({
  date: zod.coerce.string(),
});

export const DeleteRevisionDayResponse = zod.object({
  success: zod.boolean(),
});
