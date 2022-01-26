using Docstore.Application.Models;
using Docstore.Persistence;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.Mvc.Razor;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var assembly = typeof(Program).Assembly;

// Add services to the container.
builder.Services.AddPersistenceInfrastructure(builder.Configuration);

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
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();
