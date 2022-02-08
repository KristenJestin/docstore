using AspNetCoreRateLimit;
using Docstore.App.Services;
using Docstore.Application.Models;
using Docstore.Identity;
using Docstore.Persistence;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.Mvc.Razor;
using Serilog;
using Serilog.Events;
using System.Text;

// logger
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Information)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .WriteTo.File("logs/log-.txt", rollingInterval: RollingInterval.Day)
    .CreateLogger();

// builder
var builder = WebApplication.CreateBuilder(args);
var assembly = typeof(Program).Assembly;

// log
builder.Host.UseSerilog();

// Add services to the container.
builder.Services.AddPersistenceInfrastructure(builder.Configuration);
builder.Services.AddIdentityInfrastructure(builder.Configuration);

// rate limit
builder.Services.AddMemoryCache();
builder.Services.Configure<IpRateLimitOptions>(builder.Configuration.GetSection("IpRateLimiting"));
builder.Services.AddInMemoryRateLimiting();
builder.Services.AddSingleton<IRateLimitConfiguration, RateLimitConfiguration>();

// hosted
builder.Services.AddHostedService<FileWithoutDocumentFileBackgroundService>();
builder.Services.AddHostedService<DocumentFileWithoutDocumentBackgroundService>();

// controller
builder.Services.AddControllersWithViews();

var mvcBuilder = builder.Services
    .AddControllersWithViews()
    .AddFluentValidation(fv => { fv.RegisterValidatorsFromAssembly(assembly); fv.DisableDataAnnotationsValidation = true; })
    .AddRazorOptions(o => o.ViewLocationFormats.Add($"/Views/{{1}}/Partials/_{{0}}{RazorViewEngine.ViewExtension}"));

builder.Services.AddAutoMapper(assembly);

builder.Services.Configure<AppSettings>(builder.Configuration.GetSection("AppSettings"));

#if DEBUG
mvcBuilder.AddRazorRuntimeCompilation();
#endif

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHttpsRedirection();
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UsePersistenceInfrastructure();

app.UseSerilogRequestLogging();
app.UseIpRateLimiting();

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();
