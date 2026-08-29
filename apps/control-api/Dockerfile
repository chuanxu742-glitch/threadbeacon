FROM maven:3.9.11-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml ./
RUN mvn -q -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin threadbeacon
WORKDIR /app
COPY --from=build /app/target/control-api-*.jar /app/control-api.jar
USER threadbeacon
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 CMD ["wget","-q","-O","-","http://127.0.0.1:8080/api/health"]
ENTRYPOINT ["java","-XX:MaxRAMPercentage=75","-jar","/app/control-api.jar"]
