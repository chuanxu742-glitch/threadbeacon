package com.threadbeacon.control.storage;

import com.threadbeacon.control.config.ThreadBeaconProperties;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.InputStream;

@Component
public class ObjectStore {
    private final MinioClient client;
    private final String bucket;

    public ObjectStore(ThreadBeaconProperties properties) {
        var s3 = properties.s3();
        this.client = MinioClient.builder().endpoint(s3.endpoint()).credentials(s3.accessKey(), s3.secretKey()).build();
        this.bucket = s3.bucket();
    }

    @PostConstruct
    void initialize() throws Exception {
        if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
            client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
        }
    }

    public void putJson(String key, byte[] bytes) throws Exception {
        put(key, bytes, "application/json");
    }

    public void put(String key, byte[] bytes, String contentType) throws Exception {
        client.putObject(PutObjectArgs.builder().bucket(bucket).object(key)
                .contentType(contentType)
                .stream(new ByteArrayInputStream(bytes), bytes.length, -1)
                .build());
    }

    public InputStream get(String key) throws Exception {
        return client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build());
    }

    public void remove(String key) throws Exception {
        client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(key).build());
    }
}
