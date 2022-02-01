#See https://aka.ms/containerfastmode to understand how Visual Studio uses this Dockerfile to build your images for faster debugging.

FROM mcr.microsoft.com/dotnet/aspnet:6.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/sdk:6.0 AS build
WORKDIR /src
COPY ["Docstore.App/Docstore.App.csproj", "Docstore.App/"]
RUN dotnet restore "Docstore.App/Docstore.App.csproj"
COPY . .
WORKDIR "/src/Docstore.App"
RUN dotnet build "Docstore.App.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "Docstore.App.csproj" -c Release -o /app/publish

FROM node AS asset
WORKDIR /node
COPY ./Docstore.App/ClientApp /node
COPY ./Docstore.App/Views /node/Views
RUN yarn install
RUN yarn run build

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
COPY --from=asset /node/dist ./wwwroot
ENTRYPOINT ["dotnet", "Docstore.App.dll"]