package com.threadbeacon.control.node;

import java.util.List;

public record WorkerNode(String id, List<String> capabilities, int activeJobs, int maxConcurrency) {}
