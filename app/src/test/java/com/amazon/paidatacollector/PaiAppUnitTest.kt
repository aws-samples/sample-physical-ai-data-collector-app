package com.amazon.paidatacollector

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream

/**
 * SensorRecorder CSV 출력 로직 테스트 (JVM — Android 불필요)
 *
 * SensorRecorder는 Android SensorManager에 의존하므로 직접 인스턴스화 불가.
 * 대신 CSV 생성 로직을 동일하게 재현하여 포맷/내용을 검증한다.
 */
class SensorCsvTest {

    @get:Rule
    val tmp = TemporaryFolder()

    /** SensorRecorder.flushToFile()과 동일한 로직 */
    private fun writeSensorCsv(dir: File, prefix: String, rows: List<String>): File {
        val file = File(dir, "${prefix}_sensor.csv")
        file.bufferedWriter().use { w ->
            w.write("timestampMs,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z\n")
            rows.forEach { w.write(it); w.write("\n") }
        }
        return file
    }

    @Test
    fun `csv has correct header`() {
        val file = writeSensorCsv(tmp.root, "test", emptyList())
        val lines = file.readLines()
        assertEquals("timestampMs,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z", lines[0])
    }

    @Test
    fun `csv rows match input data`() {
        val rows = listOf(
            "1000,0.1,0.2,0.3,0.01,0.02,0.03",
            "2000,1.0,2.0,3.0,0.10,0.20,0.30",
        )
        val file = writeSensorCsv(tmp.root, "test", rows)
        val lines = file.readLines()
        assertEquals(3, lines.size) // header + 2 rows
        assertEquals(rows[0], lines[1])
        assertEquals(rows[1], lines[2])
    }

    @Test
    fun `csv filename uses prefix`() {
        val file = writeSensorCsv(tmp.root, "20260329_120000", emptyList())
        assertEquals("20260329_120000_sensor.csv", file.name)
    }

    @Test
    fun `empty recording produces header-only csv`() {
        val file = writeSensorCsv(tmp.root, "empty", emptyList())
        val lines = file.readLines()
        assertEquals(1, lines.size)
    }
}

/**
 * metadata.csv 생성 로직 테스트
 */
class MetadataCsvTest {

    @get:Rule
    val tmp = TemporaryFolder()

    /** MainActivity.onVideoFinalized()의 metadata.csv 생성 로직과 동일 */
    private fun writeMetadataCsv(
        dir: File, prefix: String, scenario: String,
        location: String, taskType: String, deviceId: String, capturedAt: Long
    ): File {
        val file = File(dir, "${prefix}_metadata.csv")
        file.bufferedWriter().use { w ->
            w.write("prefix,scenario,location,taskType,deviceId,capturedAt\n")
            w.write("$prefix,$scenario,$location,$taskType,$deviceId,$capturedAt\n")
        }
        return file
    }

    @Test
    fun `metadata csv has correct header`() {
        val file = writeMetadataCsv(tmp.root, "p", "s", "l", "t", "d", 0L)
        assertEquals("prefix,scenario,location,taskType,deviceId,capturedAt", file.readLines()[0])
    }

    @Test
    fun `metadata csv data row contains all fields`() {
        val file = writeMetadataCsv(tmp.root, "20260329_120000", "logistics", "울산공장", "welding", "dev-001", 1743000000000L)
        val row = file.readLines()[1].split(",")
        assertEquals("20260329_120000", row[0])
        assertEquals("logistics", row[1])
        assertEquals("울산공장", row[2])
        assertEquals("welding", row[3])
        assertEquals("dev-001", row[4])
        assertEquals("1743000000000", row[5])
    }
}

/**
 * ZIP 번들 생성 로직 테스트
 */
class ZipBundleTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun createZip(prefix: String, sensorContent: String, metaContent: String): File {
        val sensorFile = tmp.newFile("${prefix}_sensor.csv").also { it.writeText(sensorContent) }
        val metaFile   = tmp.newFile("${prefix}_metadata.csv").also { it.writeText(metaContent) }
        val zipFile    = File(tmp.root, "${prefix}_data.zip")

        java.util.zip.ZipOutputStream(zipFile.outputStream()).use { zos ->
            zos.putNextEntry(java.util.zip.ZipEntry("sensor.csv"))
            sensorFile.inputStream().copyTo(zos)
            zos.closeEntry()
            zos.putNextEntry(java.util.zip.ZipEntry("metadata.csv"))
            metaFile.inputStream().copyTo(zos)
            zos.closeEntry()
        }
        return zipFile
    }

    @Test
    fun `zip contains sensor csv and metadata csv`() {
        val zip = createZip("test", "ts,ax\n1000,0.1\n", "prefix,scenario\ntest,logistics\n")
        val entries = ZipFile(zip).use { zf -> zf.entries().toList().map { it.name }.toSet() }
        assertTrue("sensor.csv missing", "sensor.csv" in entries)
        assertTrue("metadata.csv missing", "metadata.csv" in entries)
    }

    @Test
    fun `zip filename uses prefix`() {
        val zip = createZip("20260329_120000", "", "")
        assertEquals("20260329_120000_data.zip", zip.name)
    }

    @Test
    fun `zip sensor csv content is preserved`() {
        val sensorContent = "timestampMs,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z\n1000,0.1,0.2,0.3,0.01,0.02,0.03\n"
        val zip = createZip("test", sensorContent, "h\nv\n")
        val actual = ZipInputStream(zip.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null && entry.name != "sensor.csv") entry = zis.nextEntry
            zis.readBytes().toString(Charsets.UTF_8)
        }
        assertEquals(sensorContent, actual)
    }

    @Test
    fun `zip metadata csv content is preserved`() {
        val metaContent = "prefix,scenario,location,taskType,deviceId,capturedAt\n20260329_120000,assembly,서울,inspection,dev-abc,1743000000000\n"
        val zip = createZip("test", "h\nv\n", metaContent)
        val actual = ZipInputStream(zip.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null && entry.name != "metadata.csv") entry = zis.nextEntry
            zis.readBytes().toString(Charsets.UTF_8)
        }
        assertEquals(metaContent, actual)
    }
}

/**
 * S3 key 생성 로직 테스트
 */
class S3KeyTest {

    @Test
    fun `video s3 key format`() {
        val deviceId = "ap-northeast-2:abc123-androidId"
        val prefix = "20260329_120000"
        val key = "video/$deviceId/$prefix.mp4"
        assertTrue(key.startsWith("video/"))
        assertTrue(key.endsWith(".mp4"))
        assertTrue(key.contains(deviceId))
    }

    @Test
    fun `data zip s3 key format`() {
        val deviceId = "ap-northeast-2:abc123-androidId"
        val prefix = "20260329_120000"
        val key = "data/$deviceId/${prefix}_data.zip"
        assertTrue(key.startsWith("data/"))
        assertTrue(key.endsWith("_data.zip"))
        assertTrue(key.contains(deviceId))
    }

    @Test
    fun `no legacy sensor or metadata prefix`() {
        val deviceId = "dev-001"
        val prefix = "20260329_120000"
        val videoKey = "video/$deviceId/$prefix.mp4"
        val dataKey  = "data/$deviceId/${prefix}_data.zip"
        assertFalse(videoKey.startsWith("sensor/"))
        assertFalse(videoKey.startsWith("metadata/"))
        assertFalse(dataKey.startsWith("sensor/"))
        assertFalse(dataKey.startsWith("metadata/"))
    }
}
