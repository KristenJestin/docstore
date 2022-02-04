using Docstore.Application.Interfaces;
using Docstore.Persistence.Contexts;
using Docstore.Persistence.Repositories;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Docstore.Persistence
{
    public static class ServiceRegistration
    {
        public static void AddPersistenceInfrastructure(this IServiceCollection services, IConfiguration configuration)
        {
            // database
            services.AddDbContext<ApplicationDbContext>(options => options.UseNpgsql(configuration.GetConnectionString("DefaultConnection")));
            services.AddDatabaseDeveloperPageExceptionFilter();

            #region repositories
            services.AddTransient(typeof(IGenericRepository<>), typeof(GenericRepository<>));
            services.AddTransient<IDocumentRepository, DocumentRepository>();
            services.AddTransient<IFolderRepository, FolderRepository>();
            services.AddTransient<IDocumentFileRepository, DocumentFileRepository>();
            services.AddTransient<IGlobalRepository, GlobalRepository>();
            #endregion
        }
        public static void UsePersistenceInfrastructure(this WebApplication app)
        {
            // migration
            if (!app.Environment.IsProduction())
                return;

            using var serviceScope = app.Services.GetService<IServiceScopeFactory>()!.CreateScope();
            var context = serviceScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            context.Database.Migrate();
        }
    }
}
