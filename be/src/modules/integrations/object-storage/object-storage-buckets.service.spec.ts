import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { OBJECT_STORAGE } from "@starci/object-storage"
import type { ObjectStorage } from "@starci/object-storage"
import { Secret } from "@modules/platform/config"
import { ObjectStorageError } from "./errors/object-storage.error"
import { STORAGE_OPTIONS } from "./object-storage.decorators"
import type { ObjectStorageOptions } from "./object-storage.options"
import { StorageBucketsService } from "./object-storage-buckets.service"

const options: ObjectStorageOptions = {
    endpoint: "https://minio.test:9000",
    region: "us-east-1",
    accessKey: new Secret("a"),
    secretKey: new Secret("b"),
    bucketPrefix: "nivo-dev",
    publicUrl: "https://minio.example.org",
    timeoutMs: 1000,
}

const build = async () => {
    const storage = mock<ObjectStorage>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            StorageBucketsService,
            { provide: OBJECT_STORAGE, useValue: storage },
            { provide: STORAGE_OPTIONS, useValue: options },
        ],
    }).compile()
    return { service: moduleRef.get(StorageBucketsService), storage }
}

describe("StorageBucketsService: the owned buckets as whole sets", () => {
    it("names every owned bucket by its set, the purpose without the environment prefix, in byte order", async () => {
        const { service } = await build()

        expect(service.sets()).toEqual(["avatars-public", "knowledge-uploads", "media", "records"])
    })

    it("lists, reads and heads an object in the physical bucket of this environment", async () => {
        const { service, storage } = await build()
        storage.listKeys.mockResolvedValue({ keys: [{ key: "a", size: 1 }, { key: "b", size: 2 }], next: null })
        storage.head.mockResolvedValue({ size: 3, contentType: "image/png", lastModified: null, etag: null })
        storage.get.mockResolvedValue({ bytes: new Uint8Array([1]), contentType: "image/png" })

        expect(await service.keys("avatars-public", "x", 500)).toEqual(["a", "b"])
        expect(await service.keys("media", "", 10)).toEqual(["a", "b"])
        expect(await service.head("records", "k")).toEqual({ size: 3, contentType: "image/png" })
        expect(await service.read("media", "k")).toEqual({ bytes: new Uint8Array([1]), contentType: "image/png" })

        expect(storage.listKeys).toHaveBeenCalledWith("nivo-dev-avatars-public", "x", 500)
        expect(storage.listKeys).toHaveBeenCalledWith("nivo-dev-media", null, 10)
        expect(storage.head).toHaveBeenCalledWith("nivo-dev-records", "k")
        expect(storage.get).toHaveBeenCalledWith("nivo-dev-media", "k")
    })

    it("answers null for an object that is not there", async () => {
        const { service, storage } = await build()
        storage.head.mockResolvedValue(null)

        expect(await service.head("records", "none")).toBeNull()
    })

    it("creates the bucket (public-read only for the pictures) before it writes an object", async () => {
        const { service, storage } = await build()
        const bytes = new Uint8Array([1, 2])

        await service.write("avatars-public", "u.png", bytes, "image/png")
        await service.write("records", "ws/a", bytes, "text/plain")

        expect(storage.ensureBucket.mock.calls).toEqual([
            ["nivo-dev-avatars-public", { publicRead: true }],
            ["nivo-dev-records", { publicRead: false }],
        ])
        expect(storage.put.mock.calls).toEqual([
            ["nivo-dev-avatars-public", "u.png", bytes, "image/png"],
            ["nivo-dev-records", "ws/a", bytes, "text/plain"],
        ])
    })

    it("refuses a set that names no owned bucket", async () => {
        const { service } = await build()

        await expect(service.keys("elsewhere", "", 1)).rejects.toBeInstanceOf(ObjectStorageError)
    })
})
