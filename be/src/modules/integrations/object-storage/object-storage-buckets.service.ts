import { Injectable } from "@nestjs/common"
import type { ObjectStorage } from "@starci/object-storage"
import { ObjectStorageError, ObjectStorageErrorCode } from "./errors/object-storage.error"
import { InjectObjectStorage, InjectStorageOptions } from "./object-storage.decorators"
import type { ObjectStorageOptions } from "./object-storage.options"
import type { MaybeBucketObject, MaybeBucketObjectHead, StorageBucketsPort } from "./object-storage.port"
import { STORAGE_BUCKETS, bucketNameOf, bucketSetOf, type StorageBucket } from "./object-storage.policy"

@Injectable()
/**
 * The buckets the deployment owns as whole sets of objects, for the whole-deployment copy: the set of a bucket is its purpose with hyphens
 * (no environment prefix), so a copy restores into another environment's prefix. It reaches the store only through the `ObjectStorage` port.
 */
export class StorageBucketsService implements StorageBucketsPort {
    constructor(
        @InjectObjectStorage() private readonly storage: ObjectStorage,
        @InjectStorageOptions() private readonly options: ObjectStorageOptions,
    ) {}

    /** The set of every owned bucket, in byte order. */
    sets(): ReadonlyArray<string> {
        return STORAGE_BUCKETS.map((bucket) => bucketSetOf(bucket.purpose)).sort((left, right) => left.localeCompare(right))
    }

    /** The next keys after `after`, in byte order, at most `limit`; a bucket that does not exist has none. */
    async keys(set: string, after: string, limit: number): Promise<ReadonlyArray<string>> {
        const found = await this.storage.listKeys(this.nameOf(this.ownedOf(set)), after === "" ? null : after, limit)
        return found.keys.map((listed) => listed.key)
    }

    /** The size and content type of an object, or null. */
    async head(set: string, key: string): Promise<MaybeBucketObjectHead> {
        const found = await this.storage.head(this.nameOf(this.ownedOf(set)), key)
        return found === null ? null : { size: found.size, contentType: found.contentType }
    }

    /** The bytes and content type of an object, or null. */
    read(set: string, key: string): Promise<MaybeBucketObject> {
        return this.storage.get(this.nameOf(this.ownedOf(set)), key)
    }

    /** Writes an object; the bucket is created first (and made public-read when its purpose is) so a restore into a fresh store works. */
    async write(set: string, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
        const owned = this.ownedOf(set)
        const name = this.nameOf(owned)
        await this.storage.ensureBucket(name, { publicRead: owned.publicRead })
        await this.storage.put(name, key, bytes, contentType)
    }

    /** The owned bucket of a set; a set that names none is a bug of the caller. */
    private ownedOf(set: string): StorageBucket {
        const found = STORAGE_BUCKETS.find((bucket) => bucketSetOf(bucket.purpose) === set)
        if (found === undefined)
            throw new ObjectStorageError({ code: ObjectStorageErrorCode.BucketInvalid, params: { bucket: set } })
        return found
    }

    /** The physical bucket name in this environment. */
    private nameOf(bucket: StorageBucket): string {
        return bucketNameOf(this.options.bucketPrefix, bucket.purpose)
    }
}
